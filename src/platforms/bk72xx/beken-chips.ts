/**
 * What is known about Beken chips, their bootloaders and their flash, as
 * bk7231tools knows it: the tables its chip detection and its flash
 * unprotect read.
 */

/**
 * The protocol a chip's downloader speaks: the BootROM's (BK7231N, BK7238),
 * or the smaller one of a bootloader, which Tuya's adds a version query to.
 */
export type BekenProtocol = "full" | "basic-beken" | "basic-tuya";

export type BekenChip =
  "BK7231Q" | "BK7231U" | "BK7231T" | "BK7231N" | "BK7238" | "BK7252";

/** SCTRL_CHIP_ID, which only the BootROM protocol can read. */
export const REG_CHIP_ID = 0x800000;

export const CHIP_BY_ID: ReadonlyMap<number, BekenChip> = new Map([
  [0x7231, "BK7231Q"],
  [0x0001, "BK7231U"],
  [0x7231a, "BK7231T"],
  [0x7231c, "BK7231N"],
  [0x7238, "BK7238"],
  [0x7252, "BK7252"],
]);

export interface BekenBootloader {
  name: string;
  /** CRC-32 of the first 256 bytes of flash (257 on the BootROM protocol). */
  crc: number;
  chip: BekenChip;
  protocol: BekenProtocol;
  /** 0 when the bootloader does not settle it. */
  flashSize: number;
}

const FLASH_2M = 0x200000;

const bootloader = (
  name: string,
  crc: number,
  chip: BekenChip,
  protocol: BekenProtocol,
  flashSize = 0
): BekenBootloader => ({ name, crc, chip, protocol, flashSize });

export const BOOTLOADERS: readonly BekenBootloader[] = [
  bootloader("BK7231N 1.0.1", 0xe14191ba, "BK7231N", "full"),
  bootloader("BK7238 2.0.0 (T1)", 0xf42f8c32, "BK7238", "full"),
  bootloader("BK7231Q", 0xf0231ef6, "BK7231Q", "basic-beken"),
  bootloader("BK7231Q (Tuya SDK)", 0xff5a3eac, "BK7231Q", "basic-beken"),
  bootloader("BK7231S 1.0.1", 0xc1eca871, "BK7231T", "basic-tuya", FLASH_2M),
  bootloader("BK7231S 1.0.3", 0x4b31e44d, "BK7231T", "basic-tuya", FLASH_2M),
  bootloader("BK7231S 1.0.5", 0xba54c1b8, "BK7231T", "basic-tuya", FLASH_2M),
  bootloader("BK7231S 1.0.6", 0xe5cbc953, "BK7231T", "basic-tuya", FLASH_2M),
  bootloader("BK7231U 1.0.6", 0x2739019f, "BK7231U", "basic-beken", FLASH_2M),
  bootloader("BK7252 0.1.3", 0x39f9b50c, "BK7252", "basic-beken"),
  bootloader("BK7252 (SDK)", 0xe3a27c26, "BK7252", "basic-beken"),
  bootloader("BK7238 1.0.14", 0x6beb0924, "BK7238", "full"),
];

/**
 * Bytes of the flash status register, by JEDEC id. The BootROM protocol
 * clears the block protection through it, so a flash that is not listed
 * cannot be written.
 */
export const FLASH_SR_SIZE: Readonly<Record<string, 1 | 2>> = {
  "0b4014": 2,
  "0b4015": 2,
  "0b4016": 2,
  "0b4017": 2,
  "0b6017": 2,
  "0e4016": 2,
  "1c3113": 1,
  "1c4116": 1,
  "1c7015": 1,
  "1c7016": 1,
  "204016": 2,
  "514013": 1,
  "514014": 1,
  "5e4014": 1,
  "854215": 1,
  "852015": 2,
  "856013": 2,
  "856014": 2,
  "856016": 2,
  "856017": 2,
  c22314: 2,
  c22315: 2,
  c84013: 1,
  c84014: 2,
  c84015: 2,
  c84016: 1,
  c86515: 2,
  c86516: 2,
  c86517: 2,
  cd6014: 2,
  e04013: 1,
  e04014: 1,
  eb6015: 2,
  ef4016: 2,
  ef4018: 2,
};

/** Block protection (BP0 to BP4) and CMP, the bits that keep a write out. */
export const SR_PROTECT_MASK = 0x407c;

/** A LibreTiny UF2 family and the chips its image runs on. */
export interface BekenFamily {
  id: number;
  name: string;
  chips: readonly BekenChip[];
}

export const BEKEN_FAMILIES: readonly BekenFamily[] = [
  { id: 0x7b3ef230, name: "BK7231N", chips: ["BK7231N"] },
  { id: 0x675a40b0, name: "BK7231T", chips: ["BK7231T", "BK7231U"] },
  { id: 0xafe81d49, name: "BK7231Q", chips: ["BK7231Q"] },
  { id: 0x159ac324, name: "BK7238", chips: ["BK7238"] },
  { id: 0x6a82cc42, name: "BK7251", chips: ["BK7252"] },
];

export const familyOf = (id: number): BekenFamily | undefined =>
  BEKEN_FAMILIES.find((f) => f.id === id);
