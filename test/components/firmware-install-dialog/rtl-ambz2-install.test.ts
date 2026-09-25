// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requestSerialPort: vi.fn(),
  flashAmbz2: vi.fn<(p: unknown, i: unknown, hooks: FlashHooks) => Promise<boolean>>(),
}));
type FlashHooks = {
  onProgress: (p: number) => void;
  onLog?: (line: string) => void;
  onLinked?: () => void;
  onWaitingForStrap?: () => void;
  signal?: AbortSignal;
};
vi.mock("../../../src/util/web-serial.js", () => ({
  requestSerialPort: mocks.requestSerialPort,
}));
vi.mock("../../../src/util/ambz2-flasher.js", () => ({
  flashAmbz2: mocks.flashAmbz2,
}));

import { ltPartInfo, ltTag, makeLibreTinyUf2 } from "../../_make-libretiny-uf2.js";
import type { ConfiguredDevice } from "../../../src/api/types/devices.js";
import type { FirmwareBinary } from "../../../src/api/types/firmware-jobs.js";
import {
  retryRtlAmbz2,
  rtlDoFlash,
  startRtlAmbz2Install,
} from "../../../src/components/firmware-install-dialog/rtl-ambz2-install.js";
import {
  type LibreTinyImage,
  LT_TAG,
  UF2_FAMILY_AMBZ,
} from "../../../src/util/libretiny-uf2.js";
import { asHost, bin, makeFlashHost } from "./_flash-host.js";

const bootInfo = [ltTag(LT_TAG.OTA_PART_INFO, ltPartInfo([0, 0, 0, 0, 1, 1], ["boot"]))];
const uf2 = (family?: number | null): ArrayBuffer =>
  makeLibreTinyUf2({ family, blocks: [{ addr: 0, tags: bootInfo }] }).buffer;

const device = {
  configuration: "bw15.yaml",
  name: "bw15",
  target_platform: "rtl87xx",
} as ConfiguredDevice;
const image: LibreTinyImage = {
  familyId: 0xe08f7564,
  board: "bw15",
  runs: [{ address: 0x4000, data: new Uint8Array(256) }],
  totalBytes: 256,
};

function makeHost(opts: { binaries?: FirmwareBinary[]; uf2?: ArrayBuffer } = {}) {
  return makeFlashHost(
    device,
    {
      binaries: opts.binaries ?? [
        bin("firmware.uf2", "uf2"),
        bin("image_firmware_is.0x00C000.bin"),
      ],
      downloadBytes: opts.uf2 ?? uf2(),
    },
    { _rtlImage: null as LibreTinyImage | null, installRtlAmbz2: vi.fn() }
  );
}
type Host = ReturnType<typeof makeHost>;

function readyHost(): Host {
  const host = makeHost();
  host._rtlImage = image;
  host._binaries = [bin("firmware.uf2", "uf2")];
  host._step = "rtl-ready";
  return host;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("startRtlAmbz2Install", () => {
  it("compiles, picks the UF2 by type, parses it and lands on the ready step", async () => {
    const host = makeHost();
    await startRtlAmbz2Install(asHost(host));
    expect(host._api.firmwareDownloadBytes).toHaveBeenCalledWith(
      "bw15.yaml",
      "firmware.uf2"
    );
    expect(host._rtlImage?.runs.map((r) => r.address)).toEqual([0x4000]);
    expect(host._binaries.map((b) => b.file)).toEqual(["firmware.uf2"]);
    expect(host._step).toBe("rtl-ready");
    expect(host._statusMessage).toBe("firmware.rtl_ready_title");
  });

  it("fails when the build produced no UF2", async () => {
    const host = makeHost({ binaries: [bin("image_firmware_is.0x00C000.bin")] });
    await startRtlAmbz2Install(asHost(host));
    expect(host._statusMessage).toBe("firmware.no_uf2");
    expect(host._api.firmwareDownloadBytes).not.toHaveBeenCalled();
  });

  it("refuses an AmebaZ (RTL8710B) image as the wrong family", async () => {
    const host = makeHost({ uf2: uf2(UF2_FAMILY_AMBZ) });
    await startRtlAmbz2Install(asHost(host));
    expect(host._statusMessage).toBe("firmware.rtl_wrong_family");
    expect(host._errorMessage).toContain("0x22e0d6fc");
    expect(host._rtlImage).toBeNull();
  });

  it("treats a malformed file as a bad UF2", async () => {
    const host = makeHost({ uf2: new Uint8Array(512).buffer });
    await startRtlAmbz2Install(asHost(host));
    expect(host._statusMessage).toBe("firmware.rtl_bad_uf2");
  });

  it("leaves a dialog that moved to another device untouched", async () => {
    const host = makeHost();
    vi.mocked(host._api.firmwareDownloadBytes).mockImplementation(async () => {
      host._device = { ...device, configuration: "other.yaml" } as ConfiguredDevice;
      return uf2();
    });
    await startRtlAmbz2Install(asHost(host));
    expect(host._rtlImage).toBeNull();
    expect(host._step).not.toBe("rtl-ready");
  });
});

describe("rtlDoFlash", () => {
  it("does nothing when the port picker is dismissed", async () => {
    const host = readyHost();
    mocks.requestSerialPort.mockResolvedValue(null);
    await rtlDoFlash(asHost(host));
    expect(host._step).toBe("rtl-ready");
    expect(host._flashBusy).toBe(false);
    expect(mocks.flashAmbz2).not.toHaveBeenCalled();
  });

  it("ignores a second click while the picker is open", async () => {
    const host = readyHost();
    host._flashBusy = true;
    await rtlDoFlash(asHost(host));
    expect(mocks.requestSerialPort).not.toHaveBeenCalled();
  });

  it("reports a failed picker", async () => {
    const host = readyHost();
    mocks.requestSerialPort.mockRejectedValue(new Error("no serial"));
    await rtlDoFlash(asHost(host));
    expect(host._statusMessage).toBe("firmware.browser_flash_connect_failed");
    expect(host._errorMessage).toBe("no serial");
  });

  it("walks the connect, strap-wait, flashing and done steps with the engine's hooks", async () => {
    const host = readyHost();
    const port = {};
    const steps: string[] = [];
    mocks.requestSerialPort.mockResolvedValue(port);
    mocks.flashAmbz2.mockImplementation(async (_p, _i, hooks) => {
      steps.push(host._step);
      hooks.onLog?.("Writing 0xC000 (1 bytes)");
      hooks.onWaitingForStrap?.();
      steps.push(host._step);
      hooks.onLinked?.();
      steps.push(host._step);
      hooks.onProgress(40);
      hooks.onProgress(100);
      return true;
    });
    await rtlDoFlash(asHost(host));
    expect(mocks.flashAmbz2).toHaveBeenCalledWith(
      port,
      image,
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(steps).toEqual(["rtl-connect", "rtl-wait", "flashing"]);
    expect(host._log.lines).toContain("Writing 0xC000 (1 bytes)");
    expect(host._flashPercent).toBe(100);
    expect(host._step).toBe("done");
    expect(host._statusMessage).toBe("firmware.status_done");
    expect(host._flashAbort).toBeNull();
  });

  it("asks for a manual reset when the adapter could not reboot the board", async () => {
    const host = readyHost();
    mocks.requestSerialPort.mockResolvedValue({});
    mocks.flashAmbz2.mockResolvedValue(false);
    await rtlDoFlash(asHost(host));
    expect(host._step).toBe("done");
    expect(host._statusMessage).toBe("firmware.rtl_done_manual_reset");
  });

  it("drops a late log line once the dialog moved on", async () => {
    const host = readyHost();
    mocks.requestSerialPort.mockResolvedValue({});
    mocks.flashAmbz2.mockImplementation(async (_p, _i, hooks) => {
      host._device = { name: "other" } as never;
      hooks.onLog?.("Writing 0xC000 (1 bytes)");
      return true;
    });
    await rtlDoFlash(asHost(host));
    expect(host._log.lines).not.toContain("Writing 0xC000 (1 bytes)");
  });

  it("reports a failed flash with the engine's reason", async () => {
    const host = readyHost();
    mocks.requestSerialPort.mockResolvedValue({});
    mocks.flashAmbz2.mockRejectedValue(
      new Error("Flash contents at 0xc000 do not match")
    );
    await rtlDoFlash(asHost(host));
    expect(host._step).toBe("error");
    expect(host._statusMessage).toBe("firmware.rtl_flash_failed");
    expect(host._errorMessage).toContain("0xc000");
  });

  it("stays silent when the dialog was torn down during the flash", async () => {
    const host = readyHost();
    mocks.requestSerialPort.mockResolvedValue({});
    mocks.flashAmbz2.mockImplementation(async () => {
      host._device = null;
      host._flashAbort?.abort();
      throw new DOMException("aborted", "AbortError");
    });
    await rtlDoFlash(asHost(host));
    expect(host._step).toBe("rtl-connect");
    expect(host._errorMessage).toBe("");
  });
});

describe("retryRtlAmbz2", () => {
  it("goes back to the ready step without recompiling when the image is held", () => {
    const host = readyHost();
    host._step = "error";
    host._errorMessage = "x";
    retryRtlAmbz2(asHost(host), device);
    expect(host._step).toBe("rtl-ready");
    expect(host._errorMessage).toBe("");
    expect(host.installRtlAmbz2).not.toHaveBeenCalled();
  });

  it("retries from scratch when no image is held", () => {
    const host = makeHost();
    retryRtlAmbz2(asHost(host), device);
    expect(host.installRtlAmbz2).toHaveBeenCalledWith(device);
  });
});
