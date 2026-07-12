import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/util/web-serial.js", () => ({
  connectToPort: vi.fn(),
  flashFirmware: vi.fn(),
  resetAndDisconnect: vi.fn(async () => {}),
  disconnect: vi.fn(async () => {}),
  isPortPickerCancel: vi.fn(() => false),
}));

import {
  connectToPort,
  disconnect,
  flashFirmware,
  isPortPickerCancel,
  resetAndDisconnect,
} from "../../src/util/web-serial.js";
import { runFlash, type FlashHooks } from "../../src/web/install/run-flash.js";

const port = {} as SerialPort;

function makeHooks(): FlashHooks & {
  steps: string[];
  progress: number[];
  errors: string[];
} {
  const steps: string[] = [];
  const progress: number[] = [];
  const errors: string[] = [];
  return {
    steps,
    progress,
    errors,
    onStep: (s) => steps.push(s),
    onProgress: (p) => progress.push(p),
    onLog: () => {},
    onError: (m) => errors.push(m),
  };
}

function detected(overrides: Record<string, unknown> = {}) {
  return {
    chipName: "ESP32-C3 (rev 3)",
    port,
    transport: {},
    loader: { chip: { CHIP_NAME: "ESP32-C3" }, eraseFlash: vi.fn(async () => {}) },
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(isPortPickerCancel).mockReturnValue(false);
  vi.mocked(flashFirmware).mockResolvedValue(undefined);
  vi.mocked(resetAndDisconnect).mockResolvedValue(undefined);
  vi.mocked(disconnect).mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("runFlash", () => {
  it("runs the happy path: connect → prepare → flash → reset", async () => {
    const chip = detected();
    vi.mocked(connectToPort).mockResolvedValue(chip as never);
    const filesCallback = vi.fn(async (family: string) => {
      expect(family).toBe("ESP32-C3");
      return [{ data: new Uint8Array(100), address: 0 }];
    });
    const hooks = makeHooks();

    const ok = await runFlash(port, { filesCallback }, hooks);

    expect(ok).toBe(true);
    expect(hooks.steps).toEqual(["connecting", "preparing", "flashing", "done"]);
    expect(flashFirmware).toHaveBeenCalledOnce();
    expect(resetAndDisconnect).toHaveBeenCalledOnce();
    expect(hooks.progress[hooks.progress.length - 1]).toBe(100);
  });

  it("erases first when the plan asks for it", async () => {
    const chip = detected();
    vi.mocked(connectToPort).mockResolvedValue(chip as never);
    const hooks = makeHooks();

    await runFlash(
      port,
      {
        erase: true,
        filesCallback: async () => [{ data: new Uint8Array(4), address: 0 }],
      },
      hooks
    );

    expect(chip.loader.eraseFlash).toHaveBeenCalledOnce();
    expect(hooks.steps).toContain("erasing");
  });

  it("aggregates progress across multiple parts by byte size", async () => {
    const chip = detected();
    vi.mocked(connectToPort).mockResolvedValue(chip as never);
    // Report 100% for each part so the aggregate reflects part boundaries.
    vi.mocked(flashFirmware).mockImplementation(
      async (_loader, _data, _addr, onProgress) => {
        onProgress?.({ fileIndex: 0, written: 1, total: 1, percent: 100 });
      }
    );
    const hooks = makeHooks();

    await runFlash(
      port,
      {
        filesCallback: async () => [
          { data: new Uint8Array(30), address: 0 },
          { data: new Uint8Array(10), address: 100 },
        ],
      },
      hooks
    );

    // After part 1 (30/40) → 75%, after part 2 (40/40) → 100%.
    expect(hooks.progress).toContain(75);
    expect(hooks.progress[hooks.progress.length - 1]).toBe(100);
  });

  it("reports a connect failure, falling back to the raw error without a hint", async () => {
    vi.mocked(connectToPort).mockRejectedValue(new Error("no answer"));
    const hooks = makeHooks();

    const ok = await runFlash(port, { filesCallback: async () => [] }, hooks);

    expect(ok).toBe(false);
    expect(hooks.steps).toEqual(["connecting", "error"]);
    expect(hooks.errors).toEqual(["no answer"]);
  });

  it("surfaces the localized BOOT hint on connect failure when provided", async () => {
    vi.mocked(connectToPort).mockRejectedValue(new Error("no answer"));
    const hooks = makeHooks();

    const ok = await runFlash(
      port,
      { filesCallback: async () => [], messages: { connectFailed: "hold BOOT" } },
      hooks
    );

    expect(ok).toBe(false);
    expect(hooks.errors).toEqual(["hold BOOT"]);
  });

  it("uses the localized no-firmware message when the plan yields no parts", async () => {
    vi.mocked(connectToPort).mockResolvedValue(detected() as never);
    const hooks = makeHooks();

    const ok = await runFlash(
      port,
      { filesCallback: async () => [], messages: { noFirmware: "nothing to flash" } },
      hooks
    );

    expect(ok).toBe(false);
    expect(hooks.errors).toEqual(["nothing to flash"]);
  });

  it("disconnects and errors when the files callback throws", async () => {
    vi.mocked(connectToPort).mockResolvedValue(detected() as never);
    const hooks = makeHooks();

    const ok = await runFlash(
      port,
      {
        filesCallback: async () => {
          throw new Error("unsupported chip");
        },
      },
      hooks
    );

    expect(ok).toBe(false);
    expect(hooks.steps).toEqual(["connecting", "preparing", "error"]);
    expect(hooks.errors).toEqual(["unsupported chip"]);
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("errors when there are no parts to flash", async () => {
    vi.mocked(connectToPort).mockResolvedValue(detected() as never);
    const hooks = makeHooks();

    const ok = await runFlash(port, { filesCallback: async () => [] }, hooks);

    expect(ok).toBe(false);
    expect(hooks.steps[hooks.steps.length - 1]).toBe("error");
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("disconnects and errors when the flash write fails", async () => {
    vi.mocked(connectToPort).mockResolvedValue(detected() as never);
    vi.mocked(flashFirmware).mockRejectedValue(new Error("write failed"));
    const hooks = makeHooks();

    const ok = await runFlash(
      port,
      { filesCallback: async () => [{ data: new Uint8Array(8), address: 0 }] },
      hooks
    );

    expect(ok).toBe(false);
    expect(hooks.steps).toEqual(["connecting", "preparing", "flashing", "error"]);
    expect(hooks.errors).toEqual(["write failed"]);
    expect(disconnect).toHaveBeenCalledOnce();
    expect(resetAndDisconnect).not.toHaveBeenCalled();
  });

  it("still succeeds when the post-flash reset rejects (native-USB re-enumeration)", async () => {
    vi.mocked(connectToPort).mockResolvedValue(detected() as never);
    // Native-USB chips drop/re-enumerate mid-reset, so resetAndDisconnect can
    // throw even though the write already committed.
    vi.mocked(resetAndDisconnect).mockRejectedValue(new Error("port gone"));
    const hooks = makeHooks();

    const ok = await runFlash(
      port,
      { filesCallback: async () => [{ data: new Uint8Array(8), address: 0 }] },
      hooks
    );

    // Flash succeeded; the reset hiccup must not flip it to error.
    expect(ok).toBe(true);
    expect(hooks.steps).toEqual(["connecting", "preparing", "flashing", "done"]);
    expect(hooks.errors).toEqual([]);
    expect(resetAndDisconnect).toHaveBeenCalledOnce();
    expect(disconnect).not.toHaveBeenCalled();
  });

  it("falls back to chipName when CHIP_NAME is absent", async () => {
    vi.mocked(connectToPort).mockResolvedValue(
      detected({ loader: { chip: {}, eraseFlash: vi.fn() } }) as never
    );
    const filesCallback = vi.fn(async () => [{ data: new Uint8Array(4), address: 0 }]);
    await runFlash(port, { filesCallback }, makeHooks());
    expect(filesCallback).toHaveBeenCalledWith("ESP32-C3 (rev 3)");
  });
});
