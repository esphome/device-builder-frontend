/**
 * A linked Beken chip: what is found out about it, and the flash commands
 * that depend on that, as bk7231tools has them. The protocol decides
 * whether a CRC counts the byte at its end in, whether the flash can be
 * unprotected, and whether an erase can be looked at.
 */
import { concat } from "../../util/bytes.js";
import { crc32 } from "../../util/crc32.js";
import { formatAddress } from "../../util/flash-log.js";
import {
  type BekenBootloader,
  type BekenChip,
  type BekenProtocol,
  BOOTLOADERS,
  CHIP_BY_ID,
  FLASH_SR_SIZE,
  REG_CHIP_ID,
  SR_LOCK_MASK,
  SR_PROTECT_MASK,
} from "./beken-chips.js";
import { type BekenLink, BekenResponseError, COMMAND_MS } from "./beken-link.js";
import {
  checkCrc,
  flashEraseSector,
  flashGetId,
  flashRead4k,
  flashReadSrHigh,
  flashReadSrLow,
  flashWrite,
  flashWrite4k,
  flashWriteSr,
  PAGE_SIZE,
  readBootVersion,
  readRegister,
  readU32,
  SECTOR_SIZE,
} from "./beken-packets.js";

/** The chip computes a CRC at no less than this many bytes a second. */
const CRC_BYTES_PER_SECOND = 400_000;
/** Retries, so one more attempt than this. */
const READ_RETRIES = 20;
const ERASE_RETRIES = 3;
const WRITE_RETRIES = 10;
/** Where the app sits on every known layout, readable under both protocols. */
const PROBE_ADDRESS = 0x11000;
const PROBE_LENGTH = 256;
const FLASH_SIZES = [0x200000, 0x400000, 0x800000, 0x1000000];
const ERASED = 0xff;
const CRC_ERASED_SECTOR = 0xf154670a;
/** Where the bootloader ends; nothing here erases or writes below it. */
const BOOT_END = 0x11000;
/** The CRC of a blank bootloader, under either protocol's count. */
const CRC_NO_BOOTLOADER = [PROBE_LENGTH, PROBE_LENGTH + 1].map((length) =>
  crc32(new Uint8Array(length).fill(ERASED))
);

/** The flash is one whose status register is not known, so it stays protected. */
export class BekenUnknownFlashError extends Error {
  constructor(readonly flashId: string) {
    super(`Flash ID not known: ${flashId}`);
    this.name = "BekenUnknownFlashError";
  }
}

/** The first flash sector is blank, so no firmware written to the chip can start. */
export class BekenNoBootloaderError extends Error {
  constructor() {
    super("The bootloader is missing: the start of the flash is blank");
    this.name = "BekenNoBootloaderError";
  }
}

export interface BekenChipInfo {
  protocol: BekenProtocol;
  chip: BekenChip | null;
  bootloader: BekenBootloader | null;
  bootVersion: string | null;
  flashId: string | null;
  flashSize: number;
}

const hex = (bytes: Uint8Array): string =>
  [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

const padded = (data: Uint8Array, size: number): Uint8Array => {
  if (data.length >= size) return data;
  const out = new Uint8Array(size).fill(ERASED);
  out.set(data);
  return out;
};

/** A linked chip: what was found out about it, and the commands that depend on that. */
export class BekenSession {
  // Unknown until the bootloader's CRC was read.
  private protocol: BekenProtocol | null = null;
  private bootloader: BekenBootloader | null = null;
  /** The flash's JEDEC id as hex; empty under a protocol that cannot read it. */
  private flashId = "";
  private flashSize = 0;
  /** An erase was seen to take; from then on they are trusted. */
  private eraseChecked = false;
  /**
   * Addresses are sent one flash size up: they wrap around to the same
   * place, past the range a bootloader keeps writes out of.
   */
  private bypass = true;

  constructor(
    private readonly link: BekenLink,
    private readonly log: (line: string) => void
  ) {}

  private at(address: number): number {
    return this.flashSize && this.bypass ? address + this.flashSize : address;
  }

  /**
   * A bootloader protects the flash after every CRC and takes the
   * protection back only on a LinkCheck; the BootROM does not.
   */
  private get crcLocks(): boolean {
    return this.bootloader
      ? this.bootloader.protocol !== "full"
      : this.protocol !== "full";
  }

  /** The chip's CRC-32 of ``start`` up to ``end``, which is not in it. */
  async crc(start: number, end: number): Promise<number> {
    const timeout = Math.max(
      COMMAND_MS,
      Math.ceil((end - start) / CRC_BYTES_PER_SECOND) * 1000
    );
    // The BootROM counts the byte at the end in.
    const last = this.protocol === "full" ? end - 1 : end;
    const reply = await this.link.command(
      checkCrc(this.at(start), this.at(last)),
      timeout
    );
    // bk7231tools goes on without the answer, and the erase that follows is
    // then refused without a sign; said here, it is tried again as a
    // response that did not come.
    if (this.crcLocks && !(await this.link.link(COMMAND_MS))) {
      throw new BekenResponseError("The chip did not answer after the CRC");
    }
    // The chip leaves the final XOR out.
    return (readU32(reply, 0) ^ 0xffffffff) >>> 0;
  }

  private async verify(start: number, data: Uint8Array): Promise<void> {
    const chip = await this.crc(start, start + data.length);
    const ours = crc32(data);
    if (chip !== ours) {
      throw new BekenResponseError(
        `The CRC of the flash at ${formatAddress(start)} is ${chip.toString(16)}, not ${ours.toString(16)}`
      );
    }
  }

  private async readSector(start: number): Promise<Uint8Array> {
    for (let attempt = 0; ; attempt++) {
      try {
        const reply = await this.link.command(flashRead4k(this.at(start)));
        const data = reply.subarray(5);
        if (data.length !== SECTOR_SIZE) {
          throw new BekenResponseError(`Read ${data.length} bytes of a sector`);
        }
        return data;
      } catch (err) {
        if (!(err instanceof BekenResponseError) || attempt >= READ_RETRIES) throw err;
        this.log(`Reading ${formatAddress(start)} failed, reading again`);
      }
    }
  }

  /** The chip, its protocol and its flash, as bk7231tools finds them out. */
  async detect(): Promise<BekenChipInfo> {
    const bootCrc = await this.crc(0, PROBE_LENGTH);
    if (CRC_NO_BOOTLOADER.includes(bootCrc)) throw new BekenNoBootloaderError();
    this.bootloader = BOOTLOADERS.find((b) => b.crc === bootCrc) ?? null;
    let chip = this.bootloader?.chip ?? null;
    if (this.bootloader) {
      this.protocol = this.bootloader.protocol;
    } else {
      this.log(
        `Bootloader not known (CRC ${bootCrc.toString(16)}); probing the protocol`
      );
      this.protocol = await this.probeProtocol();
    }
    let bootVersion: string | null = null;
    if (this.protocol === "full") {
      const id = readU32(await this.link.command(readRegister(REG_CHIP_ID)), 4);
      // Named for a report of a chip this does not know yet.
      if (!CHIP_BY_ID.has(id)) this.log(`Chip id not known: 0x${id.toString(16)}`);
      chip = CHIP_BY_ID.get(id) ?? chip;
      const flash = await this.link.command(flashGetId());
      this.flashId = hex(flash.subarray(2, 5));
      // An id whose size makes no sense is not one a write gets past: the
      // status register of its flash is not known.
      this.flashSize = 2 ** flash[4];
    }
    if (this.protocol === "basic-tuya") {
      const version = await this.link.command(readBootVersion());
      if (!(version.length === 1 && version[0] === 0x07)) {
        bootVersion = new TextDecoder().decode(version).replace(/^[\0 ]+|[\0 ]+$/g, "");
      }
    }
    this.flashSize ||= this.bootloader?.flashSize ?? 0;
    this.flashSize ||= await this.probeFlashSize();
    return {
      protocol: this.protocol,
      chip,
      bootloader: this.bootloader,
      bootVersion,
      flashId: this.flashId || null,
      flashSize: this.flashSize,
    };
  }

  /** By whether the chip's CRC of a range counts the byte at its end in. */
  private async probeProtocol(): Promise<BekenProtocol> {
    const crc = await this.crc(PROBE_ADDRESS, PROBE_ADDRESS + PROBE_LENGTH);
    const data = await this.readSector(PROBE_ADDRESS);
    if (crc === crc32(data.subarray(0, PROBE_LENGTH + 1))) return "full";
    if (crc === crc32(data.subarray(0, PROBE_LENGTH))) return "basic-beken";
    throw new BekenResponseError("The CRC of the flash fits neither protocol");
  }

  /** The size at which an address wraps around to the same sector. */
  private async probeFlashSize(): Promise<number> {
    this.bypass = false;
    try {
      const first = await this.readSector(PROBE_ADDRESS);
      for (const size of FLASH_SIZES) {
        const again = await this.readSector(size + PROBE_ADDRESS);
        if (first.every((b, i) => b === again[i])) return size;
      }
      throw new BekenResponseError("Could not tell the size of the flash");
    } finally {
      this.bypass = true;
    }
  }

  private async statusRegister(size: 1 | 2): Promise<number> {
    const low = (await this.link.command(flashReadSrLow()))[2];
    if (size === 1) return low;
    return low | ((await this.link.command(flashReadSrHigh()))[2] << 8);
  }

  /** How many bytes the status register of the flash has, which its id tells. */
  private statusSize(): 1 | 2 {
    const size = FLASH_SR_SIZE[this.flashId];
    if (!size) throw new BekenUnknownFlashError(this.flashId);
    return size;
  }

  /**
   * Clear the flash's block protection, which the BootROM leaves to the host.
   * A register with none set is not written.
   */
  private async unprotect(): Promise<void> {
    const size = this.statusSize();
    const sr = await this.statusRegister(size);
    if (!(sr & SR_PROTECT_MASK)) return;
    const cleared = sr & ~(SR_PROTECT_MASK | SR_LOCK_MASK);
    await this.link.command(flashWriteSr(cleared, size));
    const now = await this.statusRegister(size);
    if ((cleared & SR_PROTECT_MASK) !== (now & SR_PROTECT_MASK)) {
      throw new Error(
        `The flash kept its protection (status register ${now.toString(16)})`
      );
    }
  }

  private async eraseOnce(start: number): Promise<void> {
    const erase = () =>
      this.link.command(flashEraseSector(this.at(start), this.protocol === "full"));
    // A bootloader does not let an erase after a CRC through, so there is
    // nothing to compare; the BootROM's first erase is looked at.
    if (this.eraseChecked || this.crcLocks) {
      await erase();
      return;
    }
    // An erased sector shows nothing, so the next one is looked at instead.
    if ((await this.crc(start, start + SECTOR_SIZE)) === CRC_ERASED_SECTOR) return;
    await erase();
    if ((await this.crc(start, start + SECTOR_SIZE)) !== CRC_ERASED_SECTOR) {
      throw new BekenResponseError(
        `The erase at ${formatAddress(start)} did not take; the flash is protected`
      );
    }
    this.eraseChecked = true;
  }

  private async erase(start: number): Promise<void> {
    this.outsideBootloader(start);
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.eraseOnce(start);
      } catch (err) {
        if (!(err instanceof BekenResponseError) || attempt >= ERASE_RETRIES) throw err;
        this.log(`Erasing ${formatAddress(start)} failed, erasing again`);
      }
    }
  }

  private async writeSector(start: number, data: Uint8Array): Promise<void> {
    this.outsideBootloader(start);
    const sector = padded(data, SECTOR_SIZE);
    for (let attempt = 0; ; attempt++) {
      try {
        await this.link.command(flashWrite4k(this.at(start), sector));
        await this.verify(start, sector);
        return;
      } catch (err) {
        if (!(err instanceof BekenResponseError) || attempt >= WRITE_RETRIES) throw err;
        this.log(`Writing ${formatAddress(start)} failed, erasing and writing again`);
        await this.erase(start);
      }
    }
  }

  /** Up to a page, with what came before it in the page as erased bytes. */
  private async writePage(start: number, data: Uint8Array): Promise<void> {
    this.outsideBootloader(start);
    const reply = await this.link.command(flashWrite(this.at(start), data));
    // The count comes back in one byte, so a whole page reads 0. bk7231tools
    // compares it with 256 and fails every whole page; the CRC that follows
    // is what tells here.
    if (reply[5] !== (data.length & 0xff)) {
      throw new BekenResponseError(`Wrote ${reply[5]} of ${data.length} bytes`);
    }
    await this.verify(start, padded(data, PAGE_SIZE));
  }

  /**
   * Whether the runs can be written, before the first of them is: a run
   * that does not fit would be found with the ones before it written.
   * Nothing is sent.
   */
  check(runs: readonly { address: number; data: Uint8Array }[]): void {
    // First, so that a flash that is not known is named as that: its id
    // gives a size that means nothing.
    if (this.protocol === "full") this.statusSize();
    for (const { address, data } of runs) {
      this.outsideBootloader(address);
      if (address + data.length > this.flashSize) {
        throw new Error(
          `The run at ${formatAddress(address)} does not fit the flash of ${this.flashSize} bytes`
        );
      }
    }
  }

  /** One run of the image, as bk7231tools' ``program_flash`` writes it. */
  async program(
    address: number,
    data: Uint8Array,
    onBytes: (written: number) => void
  ): Promise<void> {
    if (this.protocol === "full") await this.unprotect();
    let at = address;
    let done = 0;
    // A run that starts inside a sector: the sector is erased, and the run
    // goes in page by page up to the sector's end.
    if (at % SECTOR_SIZE) {
      const sectorEnd = at - (at % SECTOR_SIZE) + SECTOR_SIZE;
      await this.erase(at - (at % SECTOR_SIZE));
      while (at % SECTOR_SIZE && done < data.length) {
        const lead = at % PAGE_SIZE;
        const piece = data.subarray(
          done,
          done + Math.min(PAGE_SIZE - lead, sectorEnd - at)
        );
        const page = concat(new Uint8Array(lead).fill(ERASED), piece);
        await this.writePage(at - lead, page);
        at += piece.length;
        done += piece.length;
        onBytes(done);
      }
    }
    while (done < data.length) {
      const sector = data.subarray(done, done + SECTOR_SIZE);
      await this.erase(at);
      if (sector.some((b) => b !== ERASED)) await this.writeSector(at, sector);
      at += sector.length;
      done += sector.length;
      onBytes(done);
    }
  }

  /** Refuse an address inside the bootloader. */
  private outsideBootloader(address: number): void {
    if (address < BOOT_END) {
      throw new Error(
        `${formatAddress(address)} is inside the bootloader, which is left as it is`
      );
    }
  }
}
