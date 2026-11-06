/**
 * Tests for the manual firmware-binary download flow. Pins the #1033 fix:
 * when a device produces more than one format the manual download must
 * route to the choose-binary picker (so the OTA image is reachable)
 * instead of silently auto-downloading the factory image.
 *
 * Downloads go over HTTP: api.firmwareDownloadUrl mints a tokenized URL and
 * triggerDownload navigates to it (native, streamed, mobile-friendly) so a
 * large firmware.elf isn't capped by a proxy's WebSocket max_msg_size.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const { triggerDownload } = vi.hoisted(() => ({ triggerDownload: vi.fn() }));
vi.mock("../../src/util/download-text.js", () => ({ triggerDownload }));
vi.mock("../../src/util/web-serial.js", () => ({}));
vi.mock("../../src/platforms/esp/esptool.js", () => ({
  connectToPort: vi.fn(),
  disconnect: vi.fn(),
  flashFirmware: vi.fn(),
  resetAndDisconnect: vi.fn(),
}));

import { identityLocalize } from "../_dom.js";
import { fakeBuildState, fakeLogBuffer } from "../_fake-host.js";
import {
  type FirmwareBinary,
  JobSource,
  JobStatus,
  JobType,
} from "../../src/api/types/firmware-jobs.js";
import type { ESPHomeFirmwareInstallDialog } from "../../src/components/firmware-install-dialog.js";
import { syncChecksumsWithBuilds } from "../../src/components/firmware-install-dialog/checksums.js";
import {
  downloadSelectedBinary,
  reopenPicker,
  startDownload,
} from "../../src/components/firmware-install-dialog/install-flow.js";

const FACTORY: FirmwareBinary = {
  title: "Factory format",
  file: "firmware.factory.bin",
  download_name: "device-firmware.factory.bin",
};
const OTA: FirmwareBinary = {
  title: "OTA format",
  file: "firmware.ota.bin",
  download_name: "device-firmware.ota.bin",
  description: "For OTA updating a device.",
};

type Installer = "web-serial" | "binary-download";

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
    _log: fakeLogBuffer(),
    _failureKind: null,
    _jobId: "",
    _streamId: "",
    _jobSource: JobSource.LOCAL,
    _jobSourceLabel: "",
    _open: true,
    _installRun: 0,
    _compileReject: null as null | ((e: unknown) => void),
    ...fakeBuildState(),
    _localize: identityLocalize,
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
    const single: FirmwareBinary = {
      title: "Standard format",
      file: "firmware.bin",
      download_name: "device-firmware.bin",
    };
    const { host, api } = makeHost("binary-download", [single]);
    await run(host);
    expect(api.firmwareDownloadUrl).toHaveBeenCalledWith("device.yaml", "firmware.bin");
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

  it("keeps a single artifact and records it for download-ready", async () => {
    const single: FirmwareBinary = {
      title: "Standard format",
      file: "firmware.bin",
      download_name: "device-firmware.bin",
      md5: "abc",
    };
    const { host, api } = makeHost("binary-download", [single]);
    await run(host);
    const dialog = host as unknown as ESPHomeFirmwareInstallDialog;
    expect(host._step).toBe("download-ready");
    expect(host._binaries).toEqual([single]);
    expect(dialog._checksums.downloaded).toEqual(single);
    expect(api.firmwareGetBinaries).toHaveBeenCalledTimes(1);
  });

  it("marks the digests stale once a build runs under the picker", () => {
    const { host } = makeHost("binary-download", [{ ...OTA, md5: "a" }]);
    const dialog = host as unknown as ESPHomeFirmwareInstallDialog;
    host._binaries = [{ ...OTA, md5: "a" }];
    host._activeJobs.set("device.yaml", { job_id: "upload", job_type: JobType.UPLOAD });
    syncChecksumsWithBuilds(dialog);
    expect(dialog._checksums.stale).toBe(false);
    host._activeJobs.set("device.yaml", { job_id: "rebuild", job_type: JobType.COMPILE });
    syncChecksumsWithBuilds(dialog);
    host._activeJobs.delete("device.yaml");
    syncChecksumsWithBuilds(dialog);
    expect(dialog._checksums.stale).toBe(true);
  });

  it("reopening a stale picker re-reads the list exactly once", async () => {
    const { host, api } = makeHost("binary-download", [FACTORY, OTA]);
    const dialog = host as unknown as ESPHomeFirmwareInstallDialog;
    await run(host); // choose-binary, one read
    await reopenPicker(dialog); // not stale: no read
    expect(api.firmwareGetBinaries).toHaveBeenCalledTimes(1);

    dialog._checksums = { ...dialog._checksums, stale: true };
    api.firmwareGetBinaries.mockResolvedValueOnce([{ ...OTA, md5: "new" }]);
    await reopenPicker(dialog);
    expect(api.firmwareGetBinaries).toHaveBeenCalledTimes(2);
    expect(host._step).toBe("choose-binary");
    expect(host._binaries).toEqual([{ ...OTA, md5: "new" }]);
    expect(dialog._checksums.stale).toBe(false);
  });

  it("flags the recorded row stale when the download waited out a build", async () => {
    const { host, api } = makeHost("binary-download", [{ ...OTA, md5: "before" }]);
    const dialog = host as unknown as ESPHomeFirmwareInstallDialog;
    host._binaries = [{ ...OTA, md5: "before" }];
    host._activeJobs.set("device.yaml", { job_id: "rebuild", job_type: JobType.COMPILE });
    syncChecksumsWithBuilds(dialog);
    api.firmwareFollowJob.mockImplementationOnce(
      (_id: string, cbs: { onResult: (d: unknown) => void }) => {
        host._activeJobs.delete("device.yaml");
        cbs.onResult({ status: JobStatus.COMPLETED });
        return "s2";
      }
    );
    await downloadSelectedBinary(dialog, "firmware.ota.bin");
    expect(host._step).toBe("download-ready");
    expect(dialog._checksums.downloaded?.file).toBe("firmware.ota.bin");
    expect(dialog._checksums.downloadedStale).toBe(true);
    expect(api.firmwareGetBinaries).not.toHaveBeenCalled();
  });

  it("doesn't re-read a stale picker while a build still runs", async () => {
    const { host, api } = makeHost("binary-download", [FACTORY, OTA]);
    const dialog = host as unknown as ESPHomeFirmwareInstallDialog;
    await run(host);
    dialog._checksums = { ...dialog._checksums, stale: true };
    host._activeJobs.set("device.yaml", { job_id: "b", job_type: JobType.COMPILE });
    await reopenPicker(dialog);
    expect(api.firmwareGetBinaries).toHaveBeenCalledTimes(1);
    expect(dialog._checksums.stale).toBe(true);
    expect(host._step).toBe("choose-binary");
  });

  it("fails cleanly when a stale picker's re-read comes back empty", async () => {
    const { host, api } = makeHost("binary-download", [FACTORY, OTA]);
    const dialog = host as unknown as ESPHomeFirmwareInstallDialog;
    await run(host);
    dialog._checksums = { ...dialog._checksums, stale: true };
    api.firmwareGetBinaries.mockResolvedValueOnce([]);
    await reopenPicker(dialog);
    expect(host._fail).toHaveBeenCalledWith("firmware.no_binaries");
  });

  it("ignores a second reopen while the stale re-read is in flight", async () => {
    const { host, api } = makeHost("binary-download", [FACTORY, OTA]);
    const dialog = host as unknown as ESPHomeFirmwareInstallDialog;
    await run(host);
    host._step = "download-ready";
    dialog._checksums = { ...dialog._checksums, stale: true };
    let release!: (value: FirmwareBinary[]) => void;
    api.firmwareGetBinaries.mockImplementationOnce(
      () => new Promise<FirmwareBinary[]>((resolve) => (release = resolve))
    );
    const first = reopenPicker(dialog);
    await reopenPicker(dialog); // double click
    expect(host._step).toBe("download-ready");
    release([{ ...OTA, md5: "new" }]);
    await first;
    expect(api.firmwareGetBinaries).toHaveBeenCalledTimes(2);
    expect(host._step).toBe("choose-binary");
    expect(host._binaries).toEqual([{ ...OTA, md5: "new" }]);
  });

  it("leaves a reopened dialog alone when an old re-read fails late", async () => {
    const { host, api } = makeHost("binary-download", [FACTORY, OTA]);
    const dialog = host as unknown as ESPHomeFirmwareInstallDialog;
    await run(host);
    dialog._checksums = { ...dialog._checksums, stale: true };
    api.firmwareGetBinaries.mockImplementationOnce(async () => {
      host._installRun += 1; // closed and reopened while the read was in flight
      throw new Error("boom");
    });
    await reopenPicker(dialog);
    expect(host._fail).not.toHaveBeenCalled();
  });

  it("ignores build updates once the dialog is closed", () => {
    const { host } = makeHost("binary-download", [{ ...OTA, md5: "a" }]);
    const dialog = host as unknown as ESPHomeFirmwareInstallDialog;
    host._binaries = [{ ...OTA, md5: "a" }];
    host._open = false;
    host._activeJobs.set("device.yaml", { job_id: "x", job_type: JobType.COMPILE });
    syncChecksumsWithBuilds(dialog);
    expect(dialog._checksums.stale).toBe(false);
  });

  it("fails cleanly when listing the binaries errors", async () => {
    const { host, api } = makeHost("binary-download", [FACTORY, OTA]);
    api.firmwareGetBinaries.mockRejectedValueOnce(new Error("boom"));
    await run(host);
    expect(host._fail).toHaveBeenCalledWith("firmware.download_failed");
    expect(api.firmwareDownloadUrl).not.toHaveBeenCalled();
  });

  it("names the build server when a remote compile returns no binaries", async () => {
    const { host, api } = makeHost("binary-download", []);
    api.firmwareCompile.mockResolvedValueOnce({
      job_id: "j1",
      source: JobSource.REMOTE,
      source_label: "build-server-1",
    });
    await run(host);
    expect(host._fail).toHaveBeenCalledWith(
      "firmware.no_binaries_remote",
      "firmware.no_binaries_remote_detail"
    );
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
