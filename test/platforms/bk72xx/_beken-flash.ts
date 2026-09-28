/** What the engine's tests share: the chips, a flash under way, and what to look at after. */
import { expect } from "vitest";
import { flashBeken } from "../../../src/platforms/bk72xx/beken-flasher.js";
import type { LibreTinyImage } from "../../../src/platforms/libretiny-uf2.js";
import { type ChipSpec, fakeBeken, type FakeOptions } from "./_fake-beken.js";

export const last = <T>(items: T[]): T | undefined => items[items.length - 1];

export const FAMILY = {
  n: 0x7b3ef230,
  t: 0x675a40b0,
  bk7238: 0x159ac324,
  bk7251: 0x6a82cc42,
};

export const BK7231N: ChipSpec = {
  protocol: "FULL",
  boot_crc: 0xe14191ba,
  chip_id: 0x7231c,
  flash_id: "eb6015",
  sr: 0x407c,
};
export const BK7238: ChipSpec = {
  protocol: "FULL",
  boot_crc: 0x6beb0924,
  chip_id: 0x7238,
  flash_id: "1c7015",
  sr: 0x7c,
};
export const BK7231T: ChipSpec = {
  protocol: "BASIC_TUYA",
  boot_crc: 0xba54c1b8,
  boot_version: "1.0.5",
};
export const BK7252: ChipSpec = { protocol: "BASIC_BEKEN", boot_crc: 0x39f9b50c };

export const LONG_HEAD = [0x01, 0xe0, 0xfc, 0xff, 0xf4];
export const isCommand = (frame: Uint8Array, code: number, long: boolean) =>
  long
    ? LONG_HEAD.every((b, i) => frame[i] === b) && frame[7] === code
    : frame[3] !== 0xff && frame[4] === code;

export function flash(
  spec: ChipSpec,
  image: LibreTinyImage,
  opts: FakeOptions = {},
  hooks: Partial<Parameters<typeof flashBeken>[2]> = {}
) {
  const chip = fakeBeken(spec, opts);
  const log: string[] = [];
  const progress: number[] = [];
  const done = flashBeken(chip.port, image, {
    onProgress: (p) => progress.push(p),
    onLog: (line) => log.push(line),
    ...hooks,
  });
  done.catch(() => {});
  return { chip, log, progress, done };
}

export const count = (chip: ReturnType<typeof fakeBeken>, code: number, long: boolean) =>
  chip.sent().filter((f) => isCommand(f, code, long)).length;

export const expectImage = (
  chip: ReturnType<typeof fakeBeken>,
  image: LibreTinyImage
) => {
  for (const run of image.runs) {
    expect(
      chip.flash.subarray(run.address, run.address + run.data.length),
      `run at 0x${run.address.toString(16)}`
    ).toEqual(run.data);
  }
};
