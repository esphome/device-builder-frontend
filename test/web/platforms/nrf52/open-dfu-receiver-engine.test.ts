// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadSecureDfuPackage: vi.fn(),
  flashSecureDfuPackage: vi.fn(),
  touchIntoBootloader: vi.fn(),
  pickSerialPort: vi.fn(),
}));
const port = vi.hoisted(() => ({}) as SerialPort);
vi.mock("../../../../src/platforms/nrf52/index.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadSecureDfuPackage: mocks.loadSecureDfuPackage,
  loadSecureDfuEngine: async () => ({
    flashSecureDfuPackage: mocks.flashSecureDfuPackage,
  }),
}));
vi.mock("../../../../src/util/serial-bootloader-touch.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  touchIntoBootloader: mocks.touchIntoBootloader,
}));
// The picker is the helper's own; here it answers as if a port was picked.
vi.mock("../../../../src/web/flash-receiver/serial-run.js", () => ({
  pickSerialPort: mocks.pickSerialPort,
}));

import { makeUsbPort } from "../../_make-web-serial-port.js";
import { recordingHooks as hooks, last } from "../../_receiver-hooks.js";
import { DfuResponseError } from "../../../../src/platforms/nrf52/dfu-response-error.js";
import { BootloaderTouchError } from "../../../../src/util/serial-bootloader-touch.js";
import { SerialDeviceLostError } from "../../../../src/util/serial-open-error.js";
import { PortNotAcceptedError } from "../../../../src/util/web-serial.js";
import type { ReceiverPlan } from "../../../../src/web/flash-receiver/receiver-engine.js";
import { nrfOpenDfuReceiverEngine as engine } from "../../../../src/web/platforms/nrf52/open-dfu-receiver-engine.js";

const localize = (k: string) => k;
const pkg = { parts: [] };
const parts = [{ address: 0, data: new Uint8Array([0x50, 0x4b]) }];
const APP_FILTER = { usbVendorId: 0x2fe3, usbProductId: 0x0100 };
const BOOTLOADER_FILTER = { usbVendorId: 0x1915, usbProductId: 0x521f };

async function prepared(): Promise<ReceiverPlan> {
  const plan = await engine.prepare(parts, false, localize);
  if ("error" in plan) throw new Error(plan.error);
  return plan;
}

beforeEach(() => {
  mocks.loadSecureDfuPackage.mockResolvedValue({ pkg });
  mocks.touchIntoBootloader.mockResolvedValue(true);
  mocks.flashSecureDfuPackage.mockResolvedValue(undefined);
  mocks.pickSerialPort.mockResolvedValue(port);
});
afterEach(() => vi.clearAllMocks());

describe("nrfOpenDfuReceiverEngine", () => {
  it("takes the package as one part at address 0 and rejects anything else unparsed", async () => {
    expect(
      await engine.prepare([{ address: 0x1000, data: parts[0].data }], false, localize)
    ).toEqual({
      error: "firmware.nrf_bad_package (not a single package part)",
      retryable: false,
    });
    expect(mocks.loadSecureDfuPackage).not.toHaveBeenCalled();
  });

  it("names a package that does not parse", async () => {
    mocks.loadSecureDfuPackage.mockResolvedValue({
      key: "firmware.nrf_bad_package",
      detail: "no manifest",
    });
    expect(await engine.prepare(parts, false, localize)).toEqual({
      error: "firmware.nrf_bad_package (no manifest)",
      retryable: false,
    });
  });

  it("offers the reset and the flash, with the dongle's copy", async () => {
    const plan = await prepared();
    expect(plan.before!.label).toBe("firmware.browser_flash_reset_action");
    expect(plan.primaryLabel).toBe("firmware.browser_flash_action");
    expect(plan.hint).toBe("firmware.nrf_open_step1_desc");
  });

  it("touches the application's own port and says what comes next", async () => {
    const { before } = await prepared();
    const h = hooks();
    expect(await before!.run(h)).toBeNull();
    expect(mocks.touchIntoBootloader).toHaveBeenCalledWith(
      expect.objectContaining({ filters: [APP_FILTER], accept: expect.any(Function) })
    );
    const { accept } = mocks.touchIntoBootloader.mock.calls[0][0];
    expect(accept(makeUsbPort(0x2fe3, 0x0100))).toBe(true);
    expect(accept(makeUsbPort(0x1915, 0x521f))).toBe(false);
    expect(h.waits).toEqual(["firmware.nrf_open_step2_desc"]);
  });

  it.each([
    [
      "a port that is not ESPHome's",
      new PortNotAcceptedError(makeUsbPort(0x1915, 0x521f)),
      "firmware.nrf_open_port_refused",
    ],
    [
      "a failed touch, with the RESET hint",
      new BootloaderTouchError(new Error("no DTR")),
      "firmware.nrf_open_manual_bootloader_hint",
    ],
    ["a failed pick, bare", new Error("picker broke"), "picker broke"],
  ])("names %s", async (_name, err, detail) => {
    const { before } = await prepared();
    mocks.touchIntoBootloader.mockRejectedValueOnce(err);
    const h = hooks();
    expect(await before!.run(h)).toBeNull();
    expect(last(h.states)).toBe(`error:firmware.browser_flash_connect_failed: ${detail}`);
  });

  it("flashes the parsed package over the bootloader's own port", async () => {
    const { run } = await prepared();
    mocks.flashSecureDfuPackage.mockImplementation(async (_port, _pkg, h) => {
      h.onProgress(50);
    });
    const h = hooks();
    // No port is handed on: the logs could not follow the bootloader's.
    expect(await run(h)).toEqual({});
    expect(mocks.pickSerialPort).toHaveBeenCalledWith(localize, h, {
      filters: [BOOTLOADER_FILTER],
    });
    expect(mocks.flashSecureDfuPackage).toHaveBeenCalledWith(
      port,
      pkg,
      expect.anything()
    );
    expect(h.states).toEqual(["installing:firmware.status_flashing"]);
    expect(h.onProgress).toHaveBeenCalledWith(50);
  });

  it.each([
    ["is dismissed with the port picker", "dismissed"],
    ["fails with the port picker", null],
  ] as const)("%s, and flashes nothing", async (_name, picked) => {
    const { run } = await prepared();
    mocks.pickSerialPort.mockResolvedValueOnce(picked);
    expect(await run(hooks())).toBe(picked);
    expect(mocks.flashSecureDfuPackage).not.toHaveBeenCalled();
  });

  it.each([
    [
      "a bootloader that never answers",
      new Error("No answer from the bootloader in 1000 ms"),
      "firmware.nrf_open_manual_bootloader_hint",
    ],
    [
      "a bootloader that refused the update",
      new DfuResponseError("Execute object", "no downgrade"),
      "Execute object: no downgrade",
    ],
    ["a board that was unplugged", new SerialDeviceLostError(), "serial.device_lost"],
  ])("names a flash that failed on %s", async (_name, err, detail) => {
    const { run } = await prepared();
    mocks.flashSecureDfuPackage.mockRejectedValue(err);
    const h = hooks();
    expect(await run(h)).toBeNull();
    expect(last(h.states)).toBe(`error:firmware.nrf_flash_failed: ${detail}`);
  });
});
