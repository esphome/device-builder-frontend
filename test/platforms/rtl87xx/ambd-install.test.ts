// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requestSerialPort: vi.fn(),
  dispatchShowLogsAfterInstall: vi.fn(() => true),
  flashAmbd:
    vi.fn<(p: unknown, i: unknown, hooks: LibreTinyFlashHooks) => Promise<boolean>>(),
  warmAmbd: vi.fn(async () => {}),
}));
vi.mock("../../../src/util/web-serial.js", () => ({
  requestSerialPort: mocks.requestSerialPort,
}));
vi.mock("../../../src/util/post-install-dispatch.js", () => ({
  dispatchShowLogsAfterInstall: mocks.dispatchShowLogsAfterInstall,
}));
vi.mock("../../../src/platforms/rtl87xx/ambd-flasher.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  flashAmbd: mocks.flashAmbd,
}));
// The ready step's warm-up imports the engine chunk on its own; left running
// across tests it would race the mock above, and nothing here tests it.
vi.mock("../../../src/platforms/rtl87xx/index.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  warmAmbd: mocks.warmAmbd,
}));

import { makeAmbz2Uf2 } from "../../_make-libretiny-uf2.js";
import type { ConfiguredDevice } from "../../../src/api/types/devices.js";
import type { FirmwareBinary } from "../../../src/api/types/firmware-jobs.js";
import type { LibreTinyFlashHooks } from "../../../src/platforms/libretiny-flash.js";
import { parseAmbdImage } from "../../../src/platforms/rtl87xx/ambd-image.js";
import {
  rtlAmbdDoFlash,
  rtlAmbdImage,
  rtlAmbdInstall,
  startRtlAmbdInstall,
} from "../../../src/platforms/rtl87xx/ambd-install.js";
import { AmbdLoaderError } from "../../../src/platforms/rtl87xx/ambd-loader.js";
import { SerialDeviceLostError } from "../../../src/util/serial-open-error.js";
import {
  asHost,
  bin,
  makeFlashHost,
} from "../../components/firmware-install-dialog/_flash-host.js";
import { makeAmbdUf2 } from "./_fake-ambd.js";

const UF2 = makeAmbdUf2();
const image = parseAmbdImage(UF2);
const device = {
  configuration: "bw16.yaml",
  name: "bw16",
  target_platform: "rtl87xx",
  mcu: "rtl8720d",
} as ConfiguredDevice;

function makeHost(opts: { binaries?: FirmwareBinary[]; uf2?: ArrayBuffer } = {}) {
  return makeFlashHost(
    device,
    {
      binaries: opts.binaries ?? [bin("firmware.uf2", "uf2")],
      downloadBytes: opts.uf2 ?? UF2.slice().buffer,
    },
    {
      _logsPort: null as SerialPort | null,
      _open: true,
      _showLogsAfterInstall: false,
    }
  );
}
type Host = ReturnType<typeof makeHost>;

function readyHost(): Host {
  const host = makeHost();
  rtlAmbdImage.set(asHost(host), image);
  host._binaries = [bin("firmware.uf2", "uf2")];
  host._step = "rtl-ambd-ready";
  return host;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("startRtlAmbdInstall", () => {
  it("compiles, picks the UF2, parses it and lands on the ready step", async () => {
    const host = makeHost();
    await startRtlAmbdInstall(asHost(host));
    expect(host._api.firmwareDownloadBytes).toHaveBeenCalledWith(
      "bw16.yaml",
      "firmware.uf2"
    );
    expect(rtlAmbdImage.get(asHost(host))?.ota2Offset).toBe(0x206000);
    expect(host._step).toBe("rtl-ambd-ready");
    expect(host._statusMessage).toBe("firmware.rtl_ready_title");
    // The engine and the flash loader download while the user reads the step.
    expect(mocks.warmAmbd).toHaveBeenCalledOnce();
  });

  it("refuses an RTL8720C build as the wrong family", async () => {
    const host = makeHost({ uf2: makeAmbz2Uf2().buffer });
    await startRtlAmbdInstall(asHost(host));
    expect(host._statusMessage).toBe("firmware.rtl_wrong_family");
    expect(rtlAmbdImage.get(asHost(host))).toBeNull();
  });

  it("fails when the build produced no UF2", async () => {
    const host = makeHost({ binaries: [bin("image_ota.0x006000.bin")] });
    await startRtlAmbdInstall(asHost(host));
    expect(host._statusMessage).toBe("firmware.no_uf2");
  });
});

describe("rtlAmbdDoFlash", () => {
  it("walks the connect, strap-wait, flashing and done steps with the engine's hooks", async () => {
    const host = readyHost();
    const port = {};
    const steps: string[] = [];
    mocks.requestSerialPort.mockResolvedValue(port);
    mocks.flashAmbd.mockImplementation(async (_p, _i, hooks) => {
      steps.push(host._step);
      hooks.onWaiting?.();
      steps.push(host._step);
      hooks.onLinked?.();
      steps.push(host._step);
      hooks.onProgress(100);
      return true;
    });
    await rtlAmbdDoFlash(asHost(host));
    expect(mocks.flashAmbd).toHaveBeenCalledWith(
      port,
      image,
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(steps).toEqual(["rtl-ambd-connect", "rtl-ambd-wait", "flashing"]);
    expect(host._step).toBe("done");
    expect(host._statusMessage).toBe("firmware.status_done");
  });

  it("tells the user to reset by hand when the adapter could not, and keeps the logs shut", async () => {
    const host = readyHost();
    const port = {};
    mocks.requestSerialPort.mockResolvedValue(port);
    mocks.flashAmbd.mockResolvedValue(false);
    host._showLogsAfterInstall = true;
    await rtlAmbdDoFlash(asHost(host));
    expect(host._statusMessage).toBe("firmware.rtl_ambd_done_manual_reset");
    expect(mocks.dispatchShowLogsAfterInstall).not.toHaveBeenCalled();
  });

  it("opens the logs on the flashed port once the board was rebooted", async () => {
    const host = readyHost();
    const port = {};
    mocks.requestSerialPort.mockResolvedValue(port);
    mocks.flashAmbd.mockResolvedValue(true);
    host._showLogsAfterInstall = true;
    await rtlAmbdDoFlash(asHost(host));
    expect(host._logsPort).toBe(port);
    expect(mocks.dispatchShowLogsAfterInstall).toHaveBeenCalled();
  });

  it("names a loader that could not be fetched with its own copy", async () => {
    const host = readyHost();
    mocks.requestSerialPort.mockResolvedValue({});
    mocks.flashAmbd.mockRejectedValue(
      new AmbdLoaderError("firmware.rtl_ambd_loader_unavailable", "HTTP 404")
    );
    await rtlAmbdDoFlash(asHost(host));
    expect(host._statusMessage).toBe("firmware.rtl_ambd_loader_unavailable");
    expect(host._errorMessage).toBe("HTTP 404");
  });

  it("names a board that was unplugged during the flash", async () => {
    const host = readyHost();
    mocks.requestSerialPort.mockResolvedValue({});
    mocks.flashAmbd.mockRejectedValue(new SerialDeviceLostError());
    await rtlAmbdDoFlash(asHost(host));
    expect(host._statusMessage).toBe("firmware.rtl_flash_failed");
    expect(host._errorMessage).toBe("serial.device_lost");
  });

  it("does nothing when the port picker is dismissed", async () => {
    const host = readyHost();
    mocks.requestSerialPort.mockResolvedValue(null);
    await rtlAmbdDoFlash(asHost(host));
    expect(host._step).toBe("rtl-ambd-ready");
    expect(mocks.flashAmbd).not.toHaveBeenCalled();
  });
});

describe("rtlAmbdInstall", () => {
  it("is offered for the RTL8720D and goes back to the ready step as the Retry target", () => {
    expect(rtlAmbdInstall.chips).toEqual(["rtl8720d"]);
    const host = readyHost();
    host._step = "error";
    rtlAmbdInstall.showFirstStep(asHost(host));
    expect(host._step).toBe("rtl-ambd-ready");
  });

  it("hands its UF2 to web.esphome.io's RTL8720D flasher, checked as the in-app flow checks it", async () => {
    const handoff = rtlAmbdInstall.handoff!;
    expect(handoff).toMatchObject({
      flasher: "rtl-ambd",
      erase: false,
      noArtifactKey: "firmware.no_uf2",
    });
    expect(
      handoff.pick([bin("image_ota.0x006000.bin"), bin("firmware.uf2", "uf2")], "rtl87xx")
        ?.file
    ).toBe("firmware.uf2");
    expect(await handoff.check!(UF2)).toBeNull();
    expect(await handoff.check!(makeAmbz2Uf2())).toMatchObject({
      key: "firmware.rtl_wrong_family",
    });
  });
});
