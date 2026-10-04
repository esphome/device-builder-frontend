/** Shared helpers for the LN882H engine tests. */
import { expect } from "vitest";
import type { LibreTinyImage } from "../../../src/platforms/libretiny-uf2.js";
import { flashLn882x } from "../../../src/platforms/ln882x/ln882x-flasher.js";
import { UF2_FAMILY_LN882H } from "../../../src/platforms/ln882x/ln882x-image.js";
import { fakeLn882h, type FakeOptions, referenceRuns } from "./_fake-ln882h.js";

export const image = (runs = referenceRuns()): LibreTinyImage => ({
  familyId: UF2_FAMILY_LN882H,
  board: "generic-ln882h",
  runs,
  totalBytes: runs.reduce((n, r) => n + r.data.length, 0),
});

/** Start a flash of ``img`` onto a fake chip; ``done`` is the engine's promise. */
export function flash(
  opts: FakeOptions = {},
  img: LibreTinyImage = image(),
  extra: { signal?: AbortSignal } = {}
) {
  const chip = fakeLn882h(opts);
  const log: string[] = [];
  const progress: number[] = [];
  const hooks = {
    onProgress: (p: number) => progress.push(p),
    onLog: (line: string) => log.push(line),
    onLinked: () => log.push("<linked>"),
    onWaiting: () => log.push("<waiting>"),
    signal: extra.signal,
  };
  const done = flashLn882x(chip.port, img, hooks);
  // An expected rejection is awaited by the test; don't report it as unhandled.
  done.catch(() => {});
  return { chip, log, progress, done };
}

const decoder = new TextDecoder();

/** The command lines sent, YMODEM bytes left out. */
export const commands = (chip: ReturnType<typeof fakeLn882h>): string[] =>
  chip.frames
    .filter((f) => f.dir === "tx" && f.bytes[f.bytes.length - 1] === 0x0a)
    .map((f) => decoder.decode(f.bytes).trim());

/** Every run of ``img`` is in the chip's flash. */
export function expectImage(
  chip: ReturnType<typeof fakeLn882h>,
  img: LibreTinyImage = image()
): void {
  for (const run of img.runs) {
    expect(
      chip.flash.subarray(run.address, run.address + run.data.length),
      `run at 0x${run.address.toString(16)}`
    ).toEqual(run.data);
  }
}
