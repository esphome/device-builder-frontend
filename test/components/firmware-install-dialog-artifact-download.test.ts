/**
 * Tests for the three-dot "Download" flow (startArtifactDownload). It lists
 * the device's existing build artefacts (firmware images + the ELF) so the
 * user can pick one, and compiles ONLY when nothing is built yet — an existing
 * build is served as-is, with no recompile, so the ELF's debug symbols keep
 * matching the firmware currently flashed on the device. A running build is
 * followed to completion first, without claiming it (#1200).
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
  SERIAL_ACTIVITY_WINDOW_MS: 6000,
}));

import {
  type FirmwareBinary,
  JobSource,
  JobStatus,
} from "../../src/api/types/firmware-jobs.js";
import type { ESPHomeFirmwareInstallDialog } from "../../src/components/firmware-install-dialog.js";
import {
  downloadSelectedBinary,
  startArtifactDownload,
} from "../../src/components/firmware-install-dialog/install-flow.js";
import { identityLocalize } from "../_dom.js";

const FACTORY: FirmwareBinary = { title: "Factory format", file: "firmware.factory.bin" };
const OTA: FirmwareBinary = { title: "OTA format", file: "firmware.ota.bin" };
const ELF: FirmwareBinary = {
  title: "ELF (for debugging)",
  file: "firmware.elf",
  description: "Debug symbols for the ESP stack trace decoder.",
};

type FollowCbs = {
  onResult?: (d: unknown) => void;
  onError?: (e: string) => void;
};

// get_binaries can return a different list on each call (empty before a
// compile, populated after), so accept a queue of results.
function makeHost(getBinariesResults: FirmwareBinary[][]) {
  const firmwareGetBinaries = vi.fn();
  for (const result of getBinariesResults) {
    firmwareGetBinaries.mockResolvedValueOnce(result);
  }
  const api = {
    firmwareCompile: vi
      .fn()
      .mockResolvedValue({ job_id: "j1", source: JobSource.LOCAL, source_label: "" }),
    firmwareFollowJob: vi.fn((_id: string, cbs: FollowCbs) => {
      cbs.onResult?.({ status: JobStatus.COMPLETED });
      return "s1";
    }),
    firmwareGetBinaries,
    firmwareDownloadUrl: vi.fn().mockResolvedValue({
      url: "/api/firmware/download?token=tok",
      filename: "device-firmware.elf",
    }),
  };
  const host = {
    _device: { configuration: "device.yaml" },
    _installer: "binary-download",
    _api: api,
    _step: "queued",
    _statusMessage: "",
    _binaries: [] as FirmwareBinary[],
    _downloadedFilename: "",
    _logLines: [] as string[],
    // Synchronous stand-ins for the dialog's rAF-batched log sink.
    _enqueueLogLine(line: string) {
      this._logLines = [...this._logLines, line];
    },
    _flushLogLines() {},
    _failedDuringCompile: false,
    _jobId: "",
    _streamId: "",
    _jobSource: JobSource.LOCAL,
    _jobSourceLabel: "",
    _compileReject: null as null | ((e: unknown) => void),
    _activeJobs: new Map<string, unknown>(),
    _timer: { noteLine: vi.fn() },
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
  startArtifactDownload(host as unknown as ESPHomeFirmwareInstallDialog);

afterEach(() => vi.clearAllMocks());

describe("download flow (startArtifactDownload)", () => {
  it("shows the picker without compiling when a build already exists", async () => {
    const { host, api } = makeHost([[FACTORY, OTA, ELF]]);
    await run(host);
    expect(api.firmwareCompile).not.toHaveBeenCalled();
    expect(host._step).toBe("choose-binary");
    expect(host._binaries).toEqual([FACTORY, OTA, ELF]);
    expect(api.firmwareDownloadUrl).not.toHaveBeenCalled();
  });

  it("downloads directly without compiling when one artefact exists", async () => {
    const { host, api } = makeHost([[FACTORY]]);
    await run(host);
    expect(api.firmwareCompile).not.toHaveBeenCalled();
    // With no active job there's nothing to wait on either.
    expect(api.firmwareFollowJob).not.toHaveBeenCalled();
    expect(api.firmwareDownloadUrl).toHaveBeenCalledWith(
      "device.yaml",
      "firmware.factory.bin"
    );
    expect(host._step).toBe("download-ready");
  });

  it("compiles once when nothing is built, then shows the picker", async () => {
    // First list empty (not built); after compile the artefacts appear.
    const { host, api } = makeHost([[], [FACTORY, OTA, ELF]]);
    await run(host);
    expect(api.firmwareCompile).toHaveBeenCalledTimes(1);
    expect(api.firmwareGetBinaries).toHaveBeenCalledTimes(2);
    expect(host._step).toBe("choose-binary");
    expect(host._binaries).toEqual([FACTORY, OTA, ELF]);
  });

  it("picking the ELF downloads firmware.elf and hands it to the browser", async () => {
    const { host, api } = makeHost([[FACTORY, OTA, ELF]]);
    await run(host); // lands on choose-binary
    await downloadSelectedBinary(
      host as unknown as ESPHomeFirmwareInstallDialog,
      "firmware.elf"
    );
    expect(api.firmwareDownloadUrl).toHaveBeenCalledWith("device.yaml", "firmware.elf");
    // Saved under the server-chosen filename (from firmware/download_token).
    expect(triggerDownload).toHaveBeenCalledWith(
      "/api/firmware/download?token=tok",
      "device-firmware.elf"
    );
    expect(host._step).toBe("download-ready");
  });

  it("fails when the compile produces no artefacts", async () => {
    const { host, api } = makeHost([[], []]);
    await run(host);
    expect(api.firmwareCompile).toHaveBeenCalledTimes(1);
    expect(host._step).toBe("error");
    expect(host._statusMessage).toBe("firmware.no_binaries");
    expect(api.firmwareDownloadUrl).not.toHaveBeenCalled();
  });

  it("names the build server when a remote compile returns no artefacts", async () => {
    const { host, api } = makeHost([[], []]);
    api.firmwareCompile.mockResolvedValueOnce({
      job_id: "j1",
      source: JobSource.REMOTE,
      source_label: "build-server-1",
    });
    await run(host);
    expect(host._step).toBe("error");
    expect(host._statusMessage).toBe("firmware.no_binaries_remote");
    expect(api.firmwareDownloadUrl).not.toHaveBeenCalled();
  });
});

describe("download waits for a running build (#1200)", () => {
  const runningJob = { job_id: "running-1", configuration: "device.yaml" };

  it("follows the running job to completion, then serves fresh artefacts", async () => {
    const { host, api } = makeHost([[FACTORY]]);
    host._activeJobs.set("device.yaml", runningJob);
    await run(host);
    // Waited on the running job (not a new compile), then downloaded.
    expect(api.firmwareFollowJob).toHaveBeenCalledWith("running-1", expect.anything());
    expect(api.firmwareCompile).not.toHaveBeenCalled();
    expect(api.firmwareDownloadUrl).toHaveBeenCalledWith(
      "device.yaml",
      "firmware.factory.bin"
    );
    // The dialog never claims the job it waited on: dismissing the download
    // must not cancel a build it doesn't own.
    expect(host._jobId).toBe("");
  });

  it("continues to its own compile when the awaited job ends non-completed", async () => {
    const { host, api } = makeHost([[], [FACTORY]]);
    host._activeJobs.set("device.yaml", runningJob);
    api.firmwareFollowJob.mockImplementationOnce((_id: string, cbs: FollowCbs) => {
      cbs.onResult?.({ status: JobStatus.CANCELLED });
      return "s1";
    });
    await run(host);
    // The wait resolves regardless of outcome; the empty build dir then
    // triggers the download's own (no-longer-superseding) compile.
    expect(api.firmwareCompile).toHaveBeenCalledTimes(1);
    expect(host._step).toBe("download-ready");
  });

  it("fails closed when the follow stream errors mid-wait", async () => {
    // A dead stream says nothing about the job: proceeding could still read
    // torn artifacts or supersede it, so the flow fails instead.
    const { host, api } = makeHost([[FACTORY]]);
    host._activeJobs.set("device.yaml", runningJob);
    api.firmwareFollowJob.mockImplementationOnce((_id: string, cbs: FollowCbs) => {
      cbs.onError?.("stream lost");
      return "s1";
    });
    await run(host);
    expect(host._step).toBe("error");
    expect(host._statusMessage).toBe("firmware.download_failed");
    expect(api.firmwareGetBinaries).not.toHaveBeenCalled();
    expect(api.firmwareCompile).not.toHaveBeenCalled();
  });

  it("bails without touching the backend when dismissed mid-wait", async () => {
    const { host, api } = makeHost([[FACTORY]]);
    host._activeJobs.set("device.yaml", runningJob);
    // A follow that never completes: the user closes the dialog instead.
    api.firmwareFollowJob.mockImplementationOnce(() => "s1");
    const flow = run(host);
    expect(host._compileReject).not.toBeNull();
    host._compileReject!(new Error("Install dialog dismissed"));
    await flow;
    expect(api.firmwareGetBinaries).not.toHaveBeenCalled();
    expect(api.firmwareCompile).not.toHaveBeenCalled();
    expect(api.firmwareDownloadUrl).not.toHaveBeenCalled();
  });

  it("re-waits at picker-select time for a build that started meanwhile", async () => {
    const { host, api } = makeHost([[FACTORY, OTA, ELF]]);
    await run(host); // lands on choose-binary, no job running
    expect(api.firmwareFollowJob).not.toHaveBeenCalled();
    // The race: a build starts while the picker sits open.
    host._activeJobs.set("device.yaml", runningJob);
    await downloadSelectedBinary(
      host as unknown as ESPHomeFirmwareInstallDialog,
      "firmware.ota.bin"
    );
    expect(api.firmwareFollowJob).toHaveBeenCalledWith("running-1", expect.anything());
    expect(api.firmwareDownloadUrl).toHaveBeenCalledWith(
      "device.yaml",
      "firmware.ota.bin"
    );
    expect(host._step).toBe("download-ready");
  });
});
