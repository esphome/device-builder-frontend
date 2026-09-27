// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadDfuPackage: vi.fn(),
  flashDfuPackageWithReconnect: vi.fn(),
  touchIntoBootloader: vi.fn(),
  pickSerialPort: vi.fn(),
}));
const port = vi.hoisted(() => ({}) as SerialPort);
vi.mock("../../../../src/platforms/nrf52/index.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadDfuPackage: mocks.loadDfuPackage,
  loadDfuEngine: async () => ({
    flashDfuPackageWithReconnect: mocks.flashDfuPackageWithReconnect,
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

import { recordingHooks as hooks, last } from "../../_receiver-hooks.js";
import { BootloaderTouchError } from "../../../../src/util/serial-bootloader-touch.js";
import { SerialDeviceLostError } from "../../../../src/util/serial-open-error.js";
import type { ReceiverPlan } from "../../../../src/web/flash-receiver/receiver-engine.js";
import { nrfDfuReceiverEngine as engine } from "../../../../src/web/platforms/nrf52/receiver-engine.js";

const localize = (k: string) => k;
const pkg = { parts: [] };
const parts = [{ address: 0, data: new Uint8Array([0x50, 0x4b]) }];

async function prepared(): Promise<ReceiverPlan> {
  const plan = await engine.prepare(parts, false, localize);
  if ("error" in plan) throw new Error(plan.error);
  return plan;
}

beforeEach(() => {
  mocks.loadDfuPackage.mockResolvedValue({ pkg });
  mocks.touchIntoBootloader.mockResolvedValue(true);
  mocks.flashDfuPackageWithReconnect.mockResolvedValue(undefined);
  mocks.pickSerialPort.mockResolvedValue(port);
});
afterEach(() => vi.clearAllMocks());

describe("nrfDfuReceiverEngine", () => {
  it("takes the package as one part at address 0 and rejects anything else unparsed", async () => {
    expect(
      await engine.prepare([{ address: 0x1000, data: parts[0].data }], false, localize)
    ).toEqual({
      error: "firmware.nrf_bad_package (not a single package part)",
      retryable: false,
    });
    expect(mocks.loadDfuPackage).not.toHaveBeenCalled();
  });

  it("names a package that does not parse, and can check again after a chunk did not load", async () => {
    mocks.loadDfuPackage.mockResolvedValue({
      key: "firmware.nrf_bad_package",
      detail: "no manifest",
    });
    expect(await engine.prepare(parts, false, localize)).toEqual({
      error: "firmware.nrf_bad_package (no manifest)",
      retryable: false,
    });
    mocks.loadDfuPackage.mockResolvedValue({
      key: "firmware.engine_load_failed",
      detail: "Failed to fetch",
    });
    expect(await engine.prepare(parts, false, localize)).toEqual({
      error: "web.install.tools_load_failed (Failed to fetch)",
      retryable: true,
    });
  });

  it("offers the reset and the flash", async () => {
    const plan = await prepared();
    expect(plan.before!.label).toBe("firmware.browser_flash_reset_action");
    expect(plan.primaryLabel).toBe("firmware.browser_flash_action");
    expect(plan.hint).toBe("firmware.nrf_step1_desc");
  });

  it.each([
    ["touches the board into its bootloader and says what comes next", true, null],
    ["is dismissed with the port picker, and says nothing", false, "dismissed"],
  ])("%s", async (_name, touched, outcome) => {
    const { before } = await prepared();
    mocks.touchIntoBootloader.mockResolvedValueOnce(touched);
    const h = hooks();
    expect(await before!.run(h)).toBe(outcome);
    expect(h.waits).toEqual(touched ? ["firmware.nrf_step2_desc"] : []);
  });

  it("says how to enter the bootloader by hand when the touch fails, not when the pick does", async () => {
    const { before } = await prepared();
    mocks.touchIntoBootloader.mockRejectedValueOnce(
      new BootloaderTouchError(new Error("no DTR"))
    );
    const touch = hooks();
    expect(await before!.run(touch)).toBeNull();
    expect(last(touch.states)).toBe(
      "error:firmware.browser_flash_connect_failed: firmware.nrf_manual_bootloader_hint"
    );

    mocks.touchIntoBootloader.mockRejectedValueOnce(new Error("picker broke"));
    const pick = hooks();
    expect(await before!.run(pick)).toBeNull();
    expect(last(pick.states)).toBe(
      "error:firmware.browser_flash_connect_failed: picker broke"
    );
  });

  it("flashes the parsed package over the picked port, relaying a reconnect", async () => {
    const { run } = await prepared();
    mocks.flashDfuPackageWithReconnect.mockImplementation(async (_port, _pkg, h) => {
      h.onProgress(50);
      h.onReconnecting();
    });
    const h = hooks();
    // No port is handed on: the logs could not follow the bootloader's.
    expect(await run(h)).toEqual({});
    expect(mocks.flashDfuPackageWithReconnect).toHaveBeenCalledWith(
      port,
      pkg,
      expect.anything()
    );
    expect(h.states).toEqual([
      "installing:firmware.status_flashing",
      "installing:firmware.nrf_reconnecting",
    ]);
    expect(h.onProgress).toHaveBeenCalledWith(50);
  });

  it.each([
    ["is dismissed with the port picker", "dismissed"],
    ["fails with the port picker", null],
  ] as const)("%s, and flashes nothing", async (_name, picked) => {
    const { run } = await prepared();
    mocks.pickSerialPort.mockResolvedValueOnce(picked);
    expect(await run(hooks())).toBe(picked);
    expect(mocks.flashDfuPackageWithReconnect).not.toHaveBeenCalled();
  });

  it.each([
    [
      "a bootloader that never answers",
      new Error("no ACK"),
      "firmware.nrf_manual_bootloader_hint",
    ],
    ["a board that was unplugged", new SerialDeviceLostError(), "serial.device_lost"],
  ])("names a flash that failed on %s", async (_name, err, detail) => {
    const { run } = await prepared();
    mocks.flashDfuPackageWithReconnect.mockRejectedValue(err);
    const h = hooks();
    expect(await run(h)).toBeNull();
    expect(last(h.states)).toBe(`error:firmware.nrf_flash_failed: ${detail}`);
  });
});
