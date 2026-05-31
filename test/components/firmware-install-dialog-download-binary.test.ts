/**
 * Tests for the manual firmware-binary download flow. Pins the #1033 fix:
 * when a device produces more than one format the manual download must
 * route to the choose-binary picker (so the OTA image is reachable)
 * instead of silently auto-downloading the factory image; web-flasher
 * paths still auto-select the self-contained factory image.
 *
 * Downloads go over HTTP: api.firmwareDownloadUrl mints a tokenized URL and
 * triggerDownload navigates to it (native, streamed, mobile-friendly) so a
 * large firmware.elf isn't capped by a proxy's WebSocket max_msg_size.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const { triggerDownload } = vi.hoisted(() => ({ triggerDownload: vi.fn() }));
vi.mock("../../src/util/download-text.js", () => ({ triggerDownload }));
vi.mock("../../src/util/web-serial.js", () => ({
  connectToPort: vi.fn(),
  detectChip: vi.fn(),
  disconnect: vi.fn(),
  flashFirmware: vi.fn(),
  resetAndDisconnect: vi.fn(),
}));

import {
  type FirmwareBinary,
  JobSource,
  JobStatus,
} from "../../src/api/types/firmware-jobs.js";
import type { ESPHomeFirmwareInstallDialog } from "../../src/components/firmware-install-dialog.js";
import {
  downloadSelectedBinary,
  startDownload,
} from "../../src/components/firmware-install-dialog/install-flow.js";

const FACTORY: FirmwareBinary = { title: "Factory format", file: "firmware.factory.bin" };
const OTA: FirmwareBinary = {
  title: "OTA format",
  file: "firmware.ota.bin",
  description: "For OTA updating a device.",
};

type Installer = "web-serial" | "web-download" | "binary-download";

function makeHost(installer: Installer, binaries: FirmwareBinary[]) {
  const api = {
    firmwareCompile: vi
      .fn()
      .mockResolvedValue({ job_id: "j1", source: JobSource.LOCAL, source_label: "" }),
    // Resolve the compile synchronously by firing the completion callback.
    firmwareFollowJob: vi.fn((_id: string, cbs: { onResult: (d: unknown) => void }) => {
      cbs.onResult({ status: JobStatus.COMPLETED });
      return "s1";
    }),
    firmwareGetBinaries: vi.fn().mockResolvedValue(binaries),
    firmwareDownloadUrl: vi.fn().mockResolvedValue({
      url: "/api/firmware/download?token=tok",
      filename: "device-firmware.bin",
    }),
  };
  const host = {
    _device: { configuration: "device.yaml" },
    _installer: installer,
    _api: api,
    _step: "queued",
    _statusMessage: "",
    _binaries: [] as FirmwareBinary[],
    _downloadedFilename: "",
    _logLines: [] as string[],
    _failedDuringCompile: false,
    _failedDuringValidate: false,
    _jobId: "",
    _streamId: "",
    _jobSource: JobSource.LOCAL,
    _jobSourceLabel: "",
    _compileReject: null as null | ((e: unknown) => void),
    _localize: (key: string) => key,
    _fail: vi.fn(),
  };
  host._fail = vi.fn((msg: string) => {
    host._step = "error";
    host._statusMessage = msg;
  });
  return { host, api };
}

const run = (host: ReturnType<typeof makeHost>["host"]) =>
  startDownload(host as unknown as ESPHomeFirmwareInstallDialog);

afterEach(() => vi.clearAllMocks());

describe("manual firmware-binary download flow", () => {
  it("routes to the choose-binary picker when more than one format exists", async () => {
    const { host, api } = makeHost("binary-download", [FACTORY, OTA]);
    await run(host);
    expect(host._step).toBe("choose-binary");
    expect(host._binaries).toEqual([FACTORY, OTA]);
    expect(api.firmwareDownloadUrl).not.toHaveBeenCalled();
  });

  it("downloads directly when the device produces a single format", async () => {
    const single: FirmwareBinary = { title: "Standard format", file: "firmware.bin" };
    const { host, api } = makeHost("binary-download", [single]);
    await run(host);
    expect(api.firmwareDownloadUrl).toHaveBeenCalledWith("device.yaml", "firmware.bin");
    expect(host._step).toBe("download-ready");
  });

  it("web flasher auto-selects the factory image even with multiple formats", async () => {
    const { host, api } = makeHost("web-download", [FACTORY, OTA]);
    await run(host);
    expect(api.firmwareDownloadUrl).toHaveBeenCalledWith(
      "device.yaml",
      "firmware.factory.bin"
    );
    expect(host._step).toBe("download-ready");
  });

  it("picking the OTA format downloads that file and hands it to the browser", async () => {
    const { host, api } = makeHost("binary-download", [FACTORY, OTA]);
    await run(host); // lands on choose-binary
    await downloadSelectedBinary(
      host as unknown as ESPHomeFirmwareInstallDialog,
      "firmware.ota.bin"
    );
    expect(api.firmwareDownloadUrl).toHaveBeenCalledWith(
      "device.yaml",
      "firmware.ota.bin"
    );
    // Saved under the server-chosen filename (from firmware/download_token).
    expect(triggerDownload).toHaveBeenCalledWith(
      "/api/firmware/download?token=tok",
      "device-firmware.bin"
    );
    expect(host._step).toBe("download-ready");
    // Kept so the done screen can offer "download another format".
    expect(host._binaries).toHaveLength(2);
  });

  it("fails cleanly when listing the binaries errors", async () => {
    const { host, api } = makeHost("binary-download", [FACTORY, OTA]);
    api.firmwareGetBinaries.mockRejectedValueOnce(new Error("boom"));
    await run(host);
    expect(host._fail).toHaveBeenCalledWith("firmware.download_failed");
    expect(api.firmwareDownloadUrl).not.toHaveBeenCalled();
  });

  it("re-picking after a download grabs the other format and keeps the list", async () => {
    const { host, api } = makeHost("binary-download", [FACTORY, OTA]);
    await run(host); // lands on choose-binary
    await downloadSelectedBinary(
      host as unknown as ESPHomeFirmwareInstallDialog,
      "firmware.ota.bin"
    );
    // "Download another format" → the renderer sends us back to the picker,
    // then a second pick downloads the factory image.
    await downloadSelectedBinary(
      host as unknown as ESPHomeFirmwareInstallDialog,
      "firmware.factory.bin"
    );
    expect(api.firmwareDownloadUrl).toHaveBeenLastCalledWith(
      "device.yaml",
      "firmware.factory.bin"
    );
    expect(host._step).toBe("download-ready");
    expect(host._binaries).toHaveLength(2);
  });
});
