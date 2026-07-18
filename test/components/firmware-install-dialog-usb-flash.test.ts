// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import type { ESPHomeAPI } from "../../src/api/index.js";
import type { ConfiguredDevice } from "../../src/api/types/devices.js";
import type { FirmwareBinary } from "../../src/api/types/firmware-jobs.js";
import type { ESPHomeFirmwareInstallDialog } from "../../src/components/firmware-install-dialog.js";
import {
  pickFactoryBinary,
  showOtaLogs,
  startUsbFlash,
} from "../../src/components/firmware-install-dialog/install-flow.js";
import { identityLocalize } from "../_dom.js";
import { fakeLogBuffer } from "../_fake-host.js";

const bin = (file: string): FirmwareBinary => ({ file, title: file });

function makeHost(opts: { compileOk: boolean; binaries?: FirmwareBinary[] }) {
  const api = {
    firmwareCompile: vi.fn().mockResolvedValue({ job_id: "j", source: "local" }),
    firmwareFollowJob: vi.fn((_id: string, cbs: { onResult: (d: unknown) => void }) => {
      cbs.onResult(
        opts.compileOk ? { status: "completed" } : { status: "failed", error: "boom" }
      );
      return "stream";
    }),
    firmwareGetBinaries: vi
      .fn()
      .mockResolvedValue(opts.binaries ?? [bin("firmware.factory.bin")]),
    firmwareDownloadBytes: vi.fn().mockResolvedValue(new ArrayBuffer(16)),
    stopStream: vi.fn().mockResolvedValue({ cancelled: true }),
    firmwareCancel: vi.fn().mockResolvedValue(undefined),
  } as unknown as ESPHomeAPI;

  const host = {
    _api: api,
    _device: {
      configuration: "x.yaml",
      name: "x",
      target_platform: "esp32",
    } as ConfiguredDevice,
    _localize: identityLocalize,
    _step: "queued",
    _statusMessage: "",
    _errorMessage: "",
    _log: fakeLogBuffer(),
    _jobId: "",
    _streamId: "",
    _compileReject: null,
    _jobSource: 0,
    _jobSourceLabel: "",
    _failureKind: null,
    _binaries: [] as FirmwareBinary[],
    _usbFirmware: null as ArrayBuffer | null,
    _usbFirmwareName: "",
    _fail(title: string, detail = "") {
      this._step = "error";
      this._statusMessage = title;
      this._errorMessage = detail;
    },
  };
  return host;
}

const asHost = (h: ReturnType<typeof makeHost>) =>
  h as unknown as ESPHomeFirmwareInstallDialog;

describe("startUsbFlash", () => {
  it("compiles, downloads, and lands on download-ready with firmware in hand", async () => {
    const host = makeHost({ compileOk: true });
    await startUsbFlash(asHost(host));
    expect(host._step).toBe("download-ready");
    expect(host._usbFirmware).not.toBeNull();
    expect(host._usbFirmwareName).toBe("firmware.factory.bin");
  });

  it("does not reach download-ready or hold firmware when the compile fails", async () => {
    const host = makeHost({ compileOk: false });
    await startUsbFlash(asHost(host));
    expect(host._step).toBe("error");
    // Bailed before the download step — never fetched bytes, never held firmware.
    expect(host._api.firmwareDownloadBytes).not.toHaveBeenCalled();
    expect(host._usbFirmware).toBeNull();
  });

  it("fails when no flashable image was produced", async () => {
    const host = makeHost({ compileOk: true, binaries: [bin("firmware.ota.bin")] });
    await startUsbFlash(asHost(host));
    expect(host._step).toBe("error");
    expect(host._statusMessage).toBe("firmware.no_flashable_binary");
    expect(host._usbFirmware).toBeNull();
  });
});

describe("showOtaLogs", () => {
  it("requests post-install logs over OTA, not a serial port, and closes when claimed", () => {
    const host = makeHost({ compileOk: true });
    let captured: CustomEvent<{ port?: string; webSerialPort?: unknown }> | null = null;
    const ext = host as unknown as {
      _open: boolean;
      reopen: () => void;
      dispatchEvent: (ev: Event) => boolean;
    };
    ext._open = true;
    ext.reopen = vi.fn();
    ext.dispatchEvent = (ev: Event) => {
      captured = ev as CustomEvent<{ port?: string; webSerialPort?: unknown }>;
      ev.preventDefault(); // a logs-dialog host claimed the hand-off
      return false;
    };
    showOtaLogs(asHost(host));
    expect(captured!.type).toBe("request-show-logs-after-install");
    expect(captured!.detail.port).toBe("OTA");
    expect(captured!.detail.webSerialPort).toBeUndefined();
    expect(ext._open).toBe(false);
  });
});

describe("pickFactoryBinary", () => {
  it("esp32 picks the merged factory image", () => {
    expect(
      pickFactoryBinary("esp32", [bin("firmware.ota.bin"), bin("firmware.factory.bin")])
        ?.file
    ).toBe("firmware.factory.bin");
  });

  it("esp8266 picks the single firmware.bin", () => {
    expect(
      pickFactoryBinary("esp8266", [bin("firmware.bin"), bin("firmware.factory.bin")])
        ?.file
    ).toBe("firmware.bin");
  });

  it("esp32 without a factory image returns undefined (no bare app-image fallback)", () => {
    expect(
      pickFactoryBinary("esp32", [bin("firmware.ota.bin"), bin("firmware.bin")])
    ).toBeUndefined();
  });
});
