/**
 * @vitest-environment happy-dom
 *
 * The flash and the erase end when the board is unplugged, and a write given
 * up on stops moving the progress bar (#1896).
 */
import type { ESPLoader } from "esptool-js";
import { describe, expect, it, vi } from "vitest";

import { eraseFlash, flashFirmware } from "../../../src/platforms/esp/esptool.js";
import { SerialDeviceLostError } from "../../../src/util/serial-open-error.js";

type Report = (fileIndex: number, written: number, total: number) => void;

function fakeLoader() {
  const device = new EventTarget();
  let report: Report = () => {};
  const loader = {
    transport: { device },
    // Never returns: a write to a device that is gone stays pending.
    writeFlash: vi.fn((options: { reportProgress: Report }) => {
      report = options.reportProgress;
      return new Promise<void>(() => {});
    }),
    eraseFlash: vi.fn(() => new Promise<void>(() => {})),
  };
  return {
    loader: loader as unknown as ESPLoader,
    unplug: () => device.dispatchEvent(new Event("disconnect")),
    report: (written: number, total: number) => report(0, written, total),
  };
}

describe("flashFirmware", () => {
  it("fails when the board is unplugged during the write, and reports nothing after", async () => {
    const { loader, unplug, report } = fakeLoader();
    const progress: number[] = [];
    const flash = flashFirmware(loader, new Uint8Array(4), 0, (p) =>
      progress.push(p.percent)
    );
    report(1, 4);
    unplug();
    await expect(flash).rejects.toBeInstanceOf(SerialDeviceLostError);
    report(4, 4);
    expect(progress).toEqual([25]);
  });
});

describe("eraseFlash", () => {
  it("fails when the board is unplugged during the erase", async () => {
    const { loader, unplug } = fakeLoader();
    const erase = eraseFlash(loader);
    unplug();
    await expect(erase).rejects.toBeInstanceOf(SerialDeviceLostError);
  });
});
