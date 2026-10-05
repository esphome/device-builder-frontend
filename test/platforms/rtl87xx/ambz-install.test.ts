// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requestSerialPort: vi.fn(),
  dispatchShowLogsAfterInstall: vi.fn(() => true),
  flashAmbz:
    vi.fn<(p: unknown, i: unknown, hooks: LibreTinyFlashHooks) => Promise<void>>(),
}));
vi.mock("../../../src/util/web-serial.js", () => ({
  requestSerialPort: mocks.requestSerialPort,
}));
vi.mock("../../../src/util/post-install-dispatch.js", () => ({
  dispatchShowLogsAfterInstall: mocks.dispatchShowLogsAfterInstall,
}));
vi.mock("../../../src/platforms/rtl87xx/ambz-flasher.js", () => ({
  flashAmbz: mocks.flashAmbz,
}));

import { ltPartInfoTags, makeLibreTinyUf2 } from "../../_make-libretiny-uf2.js";
import type { ConfiguredDevice } from "../../../src/api/types/devices.js";
import type { FirmwareBinary } from "../../../src/api/types/firmware-jobs.js";
import type { LibreTinyFlashHooks } from "../../../src/platforms/libretiny-flash.js";
import { parseAmbzImage } from "../../../src/platforms/rtl87xx/ambz-image.js";
import {
  rtlAmbzDoFlash,
  rtlAmbzImage,
  rtlAmbzInstall,
  startRtlAmbzInstall,
} from "../../../src/platforms/rtl87xx/ambz-install.js";
import { SerialDeviceLostError } from "../../../src/util/serial-open-error.js";
import {
  asHost,
  bin,
  makeFlashHost,
} from "../../components/firmware-install-dialog/_flash-host.js";
import { fixtureUf2 } from "./_fake-ambz.js";

const UF2 = await fixtureUf2();
const image = parseAmbzImage(UF2);
const device = {
  configuration: "bw12.yaml",
  name: "bw12",
  target_platform: "rtl87xx",
  mcu: "rtl8710b",
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
  rtlAmbzImage.set(asHost(host), image);
  host._binaries = [bin("firmware.uf2", "uf2")];
  host._step = "rtl-ambz-ready";
  return host;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("startRtlAmbzInstall", () => {
  it("compiles, picks the UF2, parses both slots and lands on the ready step", async () => {
    const host = makeHost();
    await startRtlAmbzInstall(asHost(host));
    expect(host._api.firmwareDownloadBytes).toHaveBeenCalledWith(
      "bw12.yaml",
      "firmware.uf2"
    );
    expect(rtlAmbzImage.get(asHost(host))?.ota2Offset).toBe(0x80000);
    expect(host._step).toBe("rtl-ambz-ready");
    expect(host._statusMessage).toBe("firmware.rtl_ready_title");
  });

  it("refuses an RTL8720C build as the wrong family", async () => {
    const ambz2 = makeLibreTinyUf2({
      blocks: [{ addr: 0, tags: ltPartInfoTags([0, 1, 2, 0, 1, 2], ["ota1", "ota2"]) }],
    });
    const host = makeHost({ uf2: ambz2.buffer });
    await startRtlAmbzInstall(asHost(host));
    expect(host._statusMessage).toBe("firmware.rtl_wrong_family");
    expect(rtlAmbzImage.get(asHost(host))).toBeNull();
  });

  it("fails when the build produced no UF2", async () => {
    const host = makeHost({ binaries: [bin("image2_all_ota1.bin")] });
    await startRtlAmbzInstall(asHost(host));
    expect(host._statusMessage).toBe("firmware.no_uf2");
  });
});

describe("rtlAmbzDoFlash", () => {
  it("walks the connect, strap-wait, flashing and done steps with the engine's hooks", async () => {
    const host = readyHost();
    const port = {};
    const steps: string[] = [];
    mocks.requestSerialPort.mockResolvedValue(port);
    mocks.flashAmbz.mockImplementation(async (_p, _i, hooks) => {
      steps.push(host._step);
      hooks.onWaiting?.();
      steps.push(host._step);
      hooks.onLinked?.();
      steps.push(host._step);
      hooks.onProgress(100);
    });
    await rtlAmbzDoFlash(asHost(host));
    expect(mocks.flashAmbz).toHaveBeenCalledWith(
      port,
      image,
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(steps).toEqual(["rtl-ambz-connect", "rtl-ambz-wait", "flashing"]);
    expect(host._step).toBe("done");
    expect(host._statusMessage).toBe("firmware.rtl_ambz_done_reset");
  });

  it("opens the logs on the flashed port while the board waits for its reset", async () => {
    const host = readyHost();
    const port = {};
    mocks.requestSerialPort.mockResolvedValue(port);
    mocks.flashAmbz.mockResolvedValue();
    host._showLogsAfterInstall = true;
    await rtlAmbzDoFlash(asHost(host));
    expect(host._logsPort).toBe(port);
    // The logs say to reset the board: the dialog's own status is gone by then.
    expect(mocks.dispatchShowLogsAfterInstall).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ notice: "firmware.rtl_ambz_done_reset" })
    );
  });

  it("names a board that was unplugged during the flash", async () => {
    const host = readyHost();
    mocks.requestSerialPort.mockResolvedValue({});
    mocks.flashAmbz.mockRejectedValue(new SerialDeviceLostError());
    await rtlAmbzDoFlash(asHost(host));
    expect(host._statusMessage).toBe("firmware.rtl_flash_failed");
    expect(host._errorMessage).toBe("serial.device_lost");
  });

  it("does nothing when the port picker is dismissed", async () => {
    const host = readyHost();
    mocks.requestSerialPort.mockResolvedValue(null);
    await rtlAmbzDoFlash(asHost(host));
    expect(host._step).toBe("rtl-ambz-ready");
    expect(mocks.flashAmbz).not.toHaveBeenCalled();
  });
});

describe("rtlAmbzInstall", () => {
  it("is offered for the RTL8710B and goes back to the ready step as the Retry target", () => {
    expect(rtlAmbzInstall.chips).toEqual(["rtl8710b"]);
    const host = readyHost();
    host._step = "error";
    rtlAmbzInstall.showFirstStep(asHost(host));
    expect(host._step).toBe("rtl-ambz-ready");
  });

  it("hands its UF2 to web.esphome.io's RTL8710B flasher, checked as the in-app flow checks it", async () => {
    const handoff = rtlAmbzInstall.handoff!;
    expect(handoff).toMatchObject({
      flasher: "rtl-ambz",
      erase: false,
      noArtifactKey: "firmware.no_uf2",
    });
    expect(
      handoff.pick([bin("image2_all_ota1.bin"), bin("firmware.uf2", "uf2")], "rtl87xx")
        ?.file
    ).toBe("firmware.uf2");
    expect(await handoff.check!(UF2)).toBeNull();
    const ambz2 = makeLibreTinyUf2({
      blocks: [{ addr: 0, tags: ltPartInfoTags([0, 1, 2, 0, 1, 2], ["ota1", "ota2"]) }],
    });
    expect(await handoff.check!(ambz2)).toMatchObject({
      key: "firmware.rtl_wrong_family",
    });
  });
});
