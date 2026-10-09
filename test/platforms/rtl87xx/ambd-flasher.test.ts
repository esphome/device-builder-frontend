import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { driveFakeTimers } from "../../_fake-timers.js";

const mocks = vi.hoisted(() => ({ loadAmbdLoader: vi.fn<() => Promise<Uint8Array>>() }));
// The loader itself is fetched (ambd-loader.test.ts); here it is a stand-in blob.
vi.mock("../../../src/platforms/rtl87xx/ambd-loader.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadAmbdLoader: mocks.loadAmbdLoader,
}));

import {
  BW16_PARTITIONS,
  ltHeaderTags,
  ltPartInfoTags,
  ltPartitionTable,
  makeLibreTinyUf2,
} from "../../_make-libretiny-uf2.js";
import {
  AmbdLinkError,
  AmbdLoaderError,
  AmbdVerifyError,
  flashAmbd,
} from "../../../src/platforms/rtl87xx/ambd-flasher.js";
import {
  parseAmbdImage,
  UF2_FAMILY_AMBD,
} from "../../../src/platforms/rtl87xx/ambd-image.js";
import { checksum32 } from "../../../src/platforms/rtl87xx/ambd-link.js";
import { SerialDeviceLostError } from "../../../src/util/serial-open-error.js";
import {
  fakeAmbd,
  type FakeAmbdOptions,
  IMAGE_SIGNATURE,
  STAND_IN_LOADER as LOADER,
  makeAmbdUf2,
  OTA1_OFFSET,
  OTA2_OFFSET,
} from "./_fake-ambd.js";

const IMAGE = parseAmbdImage(makeAmbdUf2());

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  mocks.loadAmbdLoader.mockReset();
  mocks.loadAmbdLoader.mockResolvedValue(LOADER);
});
afterEach(() => {
  vi.useRealTimers();
});

function flash(
  opts: FakeAmbdOptions = {},
  hooks: Partial<Parameters<typeof flashAmbd>[2]> = {}
) {
  const chip = fakeAmbd(opts);
  const log: string[] = [];
  const done = flashAmbd(chip.port, IMAGE, {
    onProgress: () => {},
    onLog: (line) => log.push(line),
    ...hooks,
  });
  return { chip, log, done };
}

const written = (chip: ReturnType<typeof fakeAmbd>) =>
  IMAGE.image.runs.every((r) => r.data.every((b, i) => chip.flash[r.address + i] === b));

describe("checksum32", () => {
  it("sums little-endian words and shifts the tail bytes in", () => {
    expect(checksum32(new Uint8Array([1, 0, 0, 0, 2, 0, 0, 0]))).toBe(3);
    expect(checksum32(new Uint8Array([0, 0, 0, 0x80, 0, 0, 0, 0x80]))).toBe(0);
    expect(checksum32(new Uint8Array([1, 0, 0, 0, 0x34, 0x12]))).toBe(0x1235);
  });
});

describe("flashAmbd", () => {
  it("resets into the ROM over DTR/RTS, loads the loader, writes, verifies and boots the firmware", async () => {
    const onWaiting = vi.fn();
    const { chip, log, done } = flash({ ota2Valid: true }, { onWaiting });
    await expect(driveFakeTimers(done)).resolves.toBe(true);
    expect(onWaiting).not.toHaveBeenCalled();
    // One open, at the log speed; no baud change.
    expect(chip.bauds).toEqual([115200]);
    // The loader went in first, then the one run; the reboot at the end dropped it again.
    expect(chip.commands.filter((c) => c === "xmodem")).toHaveLength(2);
    expect(chip.ram.subarray(0, LOADER.length)).toEqual(LOADER);
    expect(chip.loaderUp).toBe(false);
    expect(written(chip)).toBe(true);
    // The whole run's sectors were erased first; nothing else in ota1 was.
    expect([...chip.erased].sort((a, b) => a - b)).toEqual([OTA1_OFFSET, OTA2_OFFSET]);
    // The second slot's signature is gone, so the bootloader starts the first.
    expect(chip.flash.subarray(OTA2_OFFSET, OTA2_OFFSET + 8)).not.toEqual(
      IMAGE_SIGNATURE
    );
    expect(
      chip.flash.subarray(OTA2_OFFSET, OTA2_OFFSET + 0x1000).every((b) => b === 0xff)
    ).toBe(true);
    expect(chip.commands).toContain(`erase 0x${OTA2_OFFSET.toString(16)} x1`);
    expect(chip.booted).toBe(1);
    expect(chip.raw.readable).toBeNull();
    expect(log).toContainEqual(expect.stringContaining("4 MiB"));
    expect(log).toContainEqual(expect.stringMatching(/^Verified 0x6000/));
  });

  it("erases every sector the padded last block reaches", async () => {
    // 256 bytes at 0x6f00: the block pads to 0x7300, into the next sector.
    const image = parseAmbdImage(
      makeLibreTinyUf2({
        family: UF2_FAMILY_AMBD,
        headerTags: ltHeaderTags({
          BOARD: "bw16",
          FAL_PTABLE: ltPartitionTable(BW16_PARTITIONS),
        }),
        blocks: [
          { addr: 0xf00, tags: ltPartInfoTags([0, 1, 2, 0, 1, 2], ["ota1", "ota2"]) },
        ],
      })
    );
    const chip = fakeAmbd();
    await expect(
      driveFakeTimers(flashAmbd(chip.port, image, { onProgress: () => {} }))
    ).resolves.toBe(true);
    expect([...chip.erased].sort((a, b) => a - b)).toEqual([0x6000, 0x7000, OTA2_OFFSET]);
    expect(chip.flash.subarray(0x7000, 0x7300).every((b) => b === 0xff)).toBe(true);
  });

  it("reports progress per block and lands on 100", async () => {
    const percents: number[] = [];
    const { done } = flash({}, { onProgress: (p) => percents.push(p) });
    await driveFakeTimers(done);
    expect(percents[percents.length - 1]).toBe(100);
    expect(percents.slice(0, -1).every((p) => p < 100)).toBe(true);
    expect(percents).toEqual([...percents].sort((a, b) => a - b));
  });

  it("retries the reset when a CH340 loses the first pulse", async () => {
    const { chip, log, done } = flash({ lostResets: 1 });
    await expect(driveFakeTimers(done)).resolves.toBe(true);
    expect(log).toContainEqual(expect.stringContaining("attempt 2 of 3"));
    expect(written(chip)).toBe(true);
  });

  it("waits for the strap when the resets reach nothing", async () => {
    let chip!: ReturnType<typeof fakeAmbd>;
    const onWaiting = vi.fn(() => chip.strap());
    const run = flash({ lostResets: 99 }, { onWaiting });
    chip = run.chip;
    await expect(driveFakeTimers(run.done)).resolves.toBe(true);
    expect(onWaiting).toHaveBeenCalledOnce();
    expect(run.log.some((l) => l.includes("LOG_TX to GND"))).toBe(true);
    expect(written(chip)).toBe(true);
  });

  it("reaches the strap guide on an adapter without control lines and leaves the reset to the user", async () => {
    let chip!: ReturnType<typeof fakeAmbd>;
    const onWaiting = vi.fn(() => chip.strap());
    const run = flash({ noSignals: true }, { onWaiting });
    chip = run.chip;
    await expect(driveFakeTimers(run.done)).resolves.toBe(false);
    expect(onWaiting).toHaveBeenCalledOnce();
    expect(written(chip)).toBe(true);
    expect(run.log).toContainEqual(expect.stringContaining("reset it by hand"));
    expect(run.log).toContainEqual(expect.stringContaining("no control lines"));
  });

  it("gives up on a line change that never settles and goes on to the strap guide", async () => {
    let chip!: ReturnType<typeof fakeAmbd>;
    const onWaiting = vi.fn(() => chip.strap());
    const run = flash({ hangSignals: true }, { onWaiting });
    chip = run.chip;
    // The reboot at the end hangs the same way, so the user is told to reset.
    await expect(driveFakeTimers(run.done)).resolves.toBe(false);
    expect(onWaiting).toHaveBeenCalledOnce();
    expect(run.log).toContainEqual(expect.stringContaining("LOG_TX to GND"));
    expect(written(chip)).toBe(true);
    expect(chip.raw.readable).toBeNull();
  });

  it("skips the upload when the loader already runs, on an adapter that cannot reset it away", async () => {
    const { chip, log, done } = flash({ loaderResident: true, noSignals: true });
    // The engine fetches the loader before it probes, so the RAM is set in time.
    chip.ram.set(LOADER, 0);
    await driveFakeTimers(done);
    expect(log).toContain("The flash loader is already running");
    expect(chip.commands.filter((c) => c === "xmodem")).toHaveLength(1);
    expect(written(chip)).toBe(true);
  });

  it("loads the loader again when RAM kept its first word across the reset but nothing answers", async () => {
    // The fake keeps RAM across a reset while the loader itself is gone: the
    // word reads as resident, the flash id read gets no answer, and the
    // upload is repeated. Flashing twice on one chip is the Retry case.
    const chip = fakeAmbd();
    const log: string[] = [];
    const hooks = { onProgress: () => {}, onLog: (l: string) => log.push(l) };
    await driveFakeTimers(flashAmbd(chip.port, IMAGE, hooks));
    await expect(driveFakeTimers(flashAmbd(chip.port, IMAGE, hooks))).resolves.toBe(true);
    expect(log).toContain("The loader in RAM did not answer; loading it again");
    // Loader and run the first time; the loader again and the run the second.
    expect(chip.commands.filter((c) => c === "xmodem")).toHaveLength(4);
    expect(written(chip)).toBe(true);
  });

  it("takes a ROM that asks for CRC blocks, and one that NAKs the first block", async () => {
    for (const opts of [{ asksForCrc: true }, { nakFirstBlock: true }]) {
      const { chip, done } = flash(opts);
      await expect(driveFakeTimers(done)).resolves.toBe(true);
      expect(written(chip)).toBe(true);
    }
  });

  it("fails when no ROM answers before the strap wait runs out", async () => {
    const onWaiting = vi.fn();
    const { chip, done } = flash({ lostResets: 99 }, { onWaiting });
    await expect(driveFakeTimers(done)).rejects.toBeInstanceOf(AmbdLinkError);
    expect(onWaiting).toHaveBeenCalledOnce();
    expect(chip.raw.readable).toBeNull();
  });

  it.each([
    ["one its id does not give", 0x30],
    ["one past what 24-bit offsets reach", 0x19],
  ])(
    "refuses a chip whose flash size is %s, before writing anything",
    async (_n, log2) => {
      const { chip, done } = flash({ flashSizeLog2: log2 });
      await expect(driveFakeTimers(done)).rejects.toThrow(/Unknown flash size/);
      expect(chip.erased.size).toBe(0);
    }
  );

  it("refuses a chip too small for the second slot's sector, before writing anything", async () => {
    // A 2 MiB part: the bw16 layout's second slot lies past its end.
    const { chip, done } = flash({ flashSizeLog2: 0x15 });
    await expect(driveFakeTimers(done)).rejects.toThrow(/does not fit/);
    expect(chip.erased.size).toBe(0);
    expect(chip.raw.readable).toBeNull();
  });

  it("goes no further than the loader fetch when the install was cancelled meanwhile", async () => {
    const abort = new AbortController();
    mocks.loadAmbdLoader.mockImplementationOnce(async () => {
      abort.abort(new DOMException("stopped", "AbortError"));
      return LOADER;
    });
    const { chip, done } = flash({}, { signal: abort.signal });
    await expect(driveFakeTimers(done)).rejects.toMatchObject({ name: "AbortError" });
    // The port was never opened, so the board saw no reset.
    expect(chip.raw.open).not.toHaveBeenCalled();
    expect(chip.signals).toEqual([]);
  });

  it("names a board unplugged, and an install cancelled, while it waits for the strap", async () => {
    let chip!: ReturnType<typeof fakeAmbd>;
    const lost = flash({ lostResets: 99 }, { onWaiting: () => chip.dropLink() });
    chip = lost.chip;
    await expect(driveFakeTimers(lost.done)).rejects.toBeInstanceOf(
      SerialDeviceLostError
    );

    const abort = new AbortController();
    const cancelled = flash(
      { lostResets: 99 },
      {
        signal: abort.signal,
        onWaiting: () => abort.abort(new DOMException("stopped", "AbortError")),
      }
    );
    await expect(driveFakeTimers(cancelled.done)).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("fails when the loader does not start", async () => {
    const { done } = flash({ loaderDead: true });
    await expect(driveFakeTimers(done)).rejects.toThrow(/flash id read/);
  });

  it("fails on a checksum that does not match, before clearing the second slot", async () => {
    const { chip, done } = flash({ badChecksum: true, ota2Valid: true });
    await expect(driveFakeTimers(done)).rejects.toBeInstanceOf(AmbdVerifyError);
    expect(chip.flash.subarray(OTA2_OFFSET, OTA2_OFFSET + 8)).toEqual(IMAGE_SIGNATURE);
    expect(chip.raw.readable).toBeNull();
  });

  it("never opens the port when the loader cannot be fetched", async () => {
    mocks.loadAmbdLoader.mockRejectedValueOnce(
      new AmbdLoaderError("firmware.rtl_ambd_loader_unavailable", "HTTP 404")
    );
    const chip = fakeAmbd();
    await expect(
      driveFakeTimers(flashAmbd(chip.port, IMAGE, { onProgress: () => {} }))
    ).rejects.toMatchObject({ key: "firmware.rtl_ambd_loader_unavailable" });
    expect(chip.raw.open).not.toHaveBeenCalled();
    // Retry fetches again (the loader forgets a failed fetch) and goes through.
    await expect(
      driveFakeTimers(flashAmbd(chip.port, IMAGE, { onProgress: () => {} }))
    ).resolves.toBe(true);
  });

  it("names a board that goes away mid-transfer and releases the port", async () => {
    let chip!: ReturnType<typeof fakeAmbd>;
    const run = flash({}, { onProgress: (p) => p >= 30 && chip.dropLink() });
    chip = run.chip;
    await expect(driveFakeTimers(run.done)).rejects.toBeInstanceOf(SerialDeviceLostError);
    expect(chip.raw.readable).toBeNull();
  });

  it("stops at the abort signal", async () => {
    const abort = new AbortController();
    const { chip, done } = flash(
      {},
      {
        signal: abort.signal,
        onProgress: (p) => {
          if (p >= 30) abort.abort(new DOMException("stopped", "AbortError"));
        },
      }
    );
    await expect(driveFakeTimers(done)).rejects.toMatchObject({ name: "AbortError" });
    expect(chip.raw.readable).toBeNull();
  });
});
