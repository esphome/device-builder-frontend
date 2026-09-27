// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  flashPico: vi.fn(),
  touchIntoBootloader: vi.fn(),
  downloadBlob: vi.fn(),
  webUsb: true,
}));
vi.mock("../../../../src/platforms/rp2/rp2-flash.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  flashPico: mocks.flashPico,
}));
vi.mock("../../../../src/platforms/rp2/web-usb.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isWebUsbSupported: () => mocks.webUsb,
  loadPicoboot: async () => ({}),
}));
vi.mock("../../../../src/util/serial-bootloader-touch.js", () => ({
  touchIntoBootloader: mocks.touchIntoBootloader,
}));
vi.mock("../../../../src/util/download-text.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  downloadBlob: mocks.downloadBlob,
}));

import { recordingHooks as hooks, last } from "../../_receiver-hooks.js";
import { makeUf2Block } from "../../../_make-uf2-block.js";
import { PicoFlashError } from "../../../../src/platforms/rp2/rp2-flash.js";
import { RP2_SERIAL_LOGS } from "../../../../src/platforms/rp2/serial-logs.js";
import { RP2_SERIAL_PICK } from "../../../../src/platforms/rp2/web-usb.js";
import { UF2_FAMILY_RP2350_ARM_S } from "../../../../src/util/uf2.js";
import { PortNotAcceptedError } from "../../../../src/util/web-serial.js";
import type { ReceiverPlan } from "../../../../src/web/flash-receiver/receiver-engine.js";
import { rp2PicobootReceiverEngine as engine } from "../../../../src/web/platforms/rp2/receiver-engine.js";

const localize = (k: string) => k;
const uf2 = makeUf2Block({ addr: 0x10000000 });
const parts = [{ address: 0, data: uf2 }];

async function prepared(): Promise<ReceiverPlan> {
  const plan = await engine.prepare(parts, false, localize);
  if ("error" in plan) throw new Error(plan.error);
  return plan;
}

beforeEach(() => {
  mocks.webUsb = true;
  mocks.flashPico.mockResolvedValue(true);
  mocks.touchIntoBootloader.mockResolvedValue(true);
});
afterEach(() => vi.clearAllMocks());

describe("rp2PicobootReceiverEngine", () => {
  it("takes the UF2 as one part at address 0 and rejects anything else", async () => {
    expect(
      await engine.prepare([{ address: 0x1000, data: uf2 }], false, localize)
    ).toEqual({ error: "firmware.rp2_bad_uf2 (not a single UF2 part)" });
    expect(mocks.flashPico).not.toHaveBeenCalled();
    expect(await engine.prepare([...parts, ...parts], false, localize)).toHaveProperty(
      "error"
    );
  });

  it("refuses an RP2350 image, and a file that is no UF2", async () => {
    const rp2350 = makeUf2Block({ addr: 0x10000000, family: UF2_FAMILY_RP2350_ARM_S });
    const refused = await engine.prepare([{ address: 0, data: rp2350 }], false, localize);
    expect(refused).toMatchObject({
      error: expect.stringContaining("firmware.rp2_rp2350_unsupported"),
    });
    const bad = await engine.prepare(
      [{ address: 0, data: new Uint8Array(512) }],
      false,
      localize
    );
    expect(bad).toMatchObject({ error: expect.stringContaining("firmware.rp2_bad_uf2") });
  });

  it("offers the reset, the flash and the way into BOOTSEL", async () => {
    const plan = await prepared();
    expect(plan.before!.label).toBe("firmware.browser_flash_reset_action");
    expect(plan.primaryLabel).toBe("firmware.browser_flash_action");
    expect(plan.hint).toBe("firmware.rp2_bootsel_desc");
    expect(engine.logs).toBe(RP2_SERIAL_LOGS);
  });

  it("touches the Pico's own port into BOOTSEL and says what comes next", async () => {
    const { before } = await prepared();
    const h = hooks();
    expect(await before!.run(h)).toBeNull();
    expect(mocks.touchIntoBootloader).toHaveBeenCalledWith(
      expect.objectContaining(RP2_SERIAL_PICK)
    );
    expect(h.states).toEqual([
      "connecting:firmware.rp2_resetting",
      "connecting:firmware.rp2_wait_title",
    ]);
    expect(h.waits).toEqual(["firmware.rp2_wait_desc"]);
  });

  it("is dismissed with the port picker, and names a probe or a failed touch", async () => {
    const { before } = await prepared();
    mocks.touchIntoBootloader.mockResolvedValueOnce(false);
    expect(await before!.run(hooks())).toBe("dismissed");

    mocks.touchIntoBootloader.mockRejectedValueOnce(
      new PortNotAcceptedError({} as SerialPort)
    );
    const probe = hooks();
    expect(await before!.run(probe)).toBeNull();
    expect(last(probe.states)).toBe("error:firmware.rp2_not_a_pico");

    mocks.touchIntoBootloader.mockRejectedValueOnce(new Error("no DTR"));
    const failed = hooks();
    expect(await before!.run(failed)).toBeNull();
    expect(last(failed.states)).toMatch(/^error:firmware.browser_flash_connect_failed: /);
  });

  it("writes the parsed image over PICOBOOT and leaves no port for logs", async () => {
    const { run } = await prepared();
    mocks.flashPico.mockImplementation(async (_image, h) => {
      h.onDeviceOpened();
      h.onProgress(50);
      return true;
    });
    const h = hooks();
    expect(await run(h)).toEqual({});
    expect(mocks.flashPico.mock.calls[0][0]).toMatchObject({ totalBytes: 256 });
    expect(h.states).toEqual(["installing:firmware.status_flashing"]);
    expect(h.onProgress).toHaveBeenCalledWith(50);
  });

  it("is dismissed with the USB chooser", async () => {
    const { run } = await prepared();
    mocks.flashPico.mockResolvedValue(false);
    expect(await run(hooks())).toBe("dismissed");
  });

  it.each([
    ["not-bootsel", "error:firmware.rp2_not_bootsel"],
    ["rp2350", "error:firmware.rp2_rp2350_device"],
    ["device-lost", "error:firmware.rp2_flash_failed: firmware.rp2_device_lost"],
  ] as const)("names a write that failed as %s", async (kind, line) => {
    const { run } = await prepared();
    mocks.flashPico.mockRejectedValue(new PicoFlashError(kind));
    const h = hooks();
    expect(await run(h)).toBeNull();
    expect(last(h.states)).toBe(line);
  });

  it("names a failure the flash did not, as a failed flash", async () => {
    const { run } = await prepared();
    mocks.flashPico.mockRejectedValue(new Error("boom"));
    const h = hooks();
    expect(await run(h)).toBeNull();
    expect(last(h.states)).toBe("error:firmware.rp2_flash_failed: boom");
  });

  describe("without WebUSB", () => {
    beforeEach(() => {
      mocks.webUsb = false;
    });

    it("offers the download in place of the flash", async () => {
      const plan = await prepared();
      expect(plan.primaryLabel).toBe("firmware.rp2_download_action");
      expect(plan.hint).toBe("firmware.rp2_bootsel_desc_download");
      const h = hooks();
      await plan.before!.run(h);
      expect(h.waits).toEqual(["firmware.rp2_wait_desc_download"]);
    });

    it("saves the UF2 it was handed and says where to copy it", async () => {
      const { run } = await prepared();
      const h = hooks();
      expect(await run(h)).toEqual({
        message: "firmware.rp2_uf2_download_done_title",
        note: { message: "firmware.rp2_uf2_download_done_body" },
      });
      expect(mocks.downloadBlob).toHaveBeenCalledWith(
        uf2,
        "firmware.uf2",
        "application/octet-stream"
      );
      expect(mocks.flashPico).not.toHaveBeenCalled();
    });

    it("names a save that failed, and claims nothing done", async () => {
      const { run } = await prepared();
      mocks.downloadBlob.mockImplementationOnce(() => {
        throw new Error("blocked");
      });
      const h = hooks();
      expect(await run(h)).toBeNull();
      expect(last(h.states)).toBe("error:firmware.download_failed blocked");
    });
  });
});
