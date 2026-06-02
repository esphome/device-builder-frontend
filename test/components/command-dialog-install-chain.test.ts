/**
 * Install follows the COMPILE then its dependent UPLOAD (backend #1131).
 *
 * firmware/install returns the COMPILE job; the UPLOAD is held off its lane
 * (depends_on === compile job_id) until the compile succeeds, then flashes.
 * followJob must hand off to the upload on a successful compile and only
 * report success once the upload finishes, instead of declaring the device
 * flashed the moment it compiled.
 */
import { describe, expect, it, vi } from "vitest";
import {
  type FirmwareJob,
  JobSource,
  JobStatus,
  JobType,
} from "../../src/api/types/firmware-jobs.js";
import type { ESPHomeCommandDialog } from "../../src/components/command-dialog.js";
import {
  followJob,
  onForceLocalClick,
} from "../../src/components/command-dialog/commands.js";

interface StreamCbs {
  onOutput: (line: string) => void;
  onResult: (data: unknown) => void;
  onError: (error: string) => void;
}

function makeJob(overrides: Partial<FirmwareJob> = {}): FirmwareJob {
  return {
    job_id: "job-1",
    configuration: "kitchen.yaml",
    job_type: JobType.COMPILE,
    status: JobStatus.RUNNING,
    created_at: "2026-01-01T00:00:00Z",
    started_at: null,
    completed_at: null,
    exit_code: null,
    output: [],
    error: null,
    port: "OTA",
    new_name: "",
    depends_on: "",
    progress: null,
    source: JobSource.LOCAL,
    source_pin_sha256: "",
    source_label: "",
    source_esphome_version: "",
    remote_peer: "",
    remote_peer_label: "",
    device_name: "",
    device_friendly_name: "",
    ...overrides,
  };
}

function makeHost(
  jobs: Map<string, FirmwareJob>,
  apiExtra: Record<string, unknown> = {}
) {
  const follows: Record<string, StreamCbs> = {};
  let flipped = false;
  let streamSeq = 0;
  const host = {
    _api: {
      firmwareFollowJob: (jobId: string, cbs: StreamCbs): string => {
        follows[jobId] = cbs;
        return `stream-${++streamSeq}`;
      },
      ...apiExtra,
    },
    _jobs: jobs,
    _commandType: "install",
    _jobId: "",
    _jobStatus: JobStatus.RUNNING,
    _state: "running",
    _statusMessage: "",
    _streamId: "",
    _switchingToLocal: false,
    configuration: "kitchen.yaml",
    name: "kitchen",
    _port: "OTA",
    _lines: [] as string[],
    _showLogsAfterInstall: true,
    _failedDuringValidate: false,
    _localize: (key: string) => key,
    _flipToLogs: () => {
      flipped = true;
    },
    _flushPendingLines: () => {},
    _resetPendingLines: () => {},
    _enqueueLine: () => {},
  };
  return {
    host: host as unknown as ESPHomeCommandDialog,
    follows,
    flipped: () => flipped,
  };
}

describe("command-dialog install chain follow", () => {
  it("follows the compile into its upload and only succeeds after the upload", () => {
    const compile = makeJob({ job_id: "c1", job_type: JobType.COMPILE });
    const upload = makeJob({
      job_id: "u1",
      job_type: JobType.UPLOAD,
      status: JobStatus.QUEUED,
      depends_on: "c1",
    });
    const { host, follows, flipped } = makeHost(
      new Map([
        ["c1", compile],
        ["u1", upload],
      ])
    );

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    host._jobId = "c1";
    followJob(host, "c1");
    follows.c1.onResult({ status: JobStatus.COMPLETED, exit_code: 0 });

    // Compile done, but the install is not — it's now following the upload.
    expect(host._state).toBe("running");
    expect(host._jobId).toBe("u1");
    expect(follows.u1).toBeDefined();
    expect(flipped()).toBe(false);

    follows.u1.onResult({ status: JobStatus.COMPLETED, exit_code: 0 });

    expect(host._state).toBe("success");
    expect(host._statusMessage).toBe("command.install_success");
    expect(host._jobId).toBe("");
    expect(flipped()).toBe(true);
    // The upload's completion must not re-trigger the missing-upload warning.
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("warns (and falls through to success) when a compile has no dependent upload", () => {
    const compile = makeJob({ job_id: "c1", job_type: JobType.COMPILE });
    // No upload in context — a genuine backend/transport gap, not the happy path.
    const { host, follows, flipped } = makeHost(new Map([["c1", compile]]));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    host._jobId = "c1";
    followJob(host, "c1");
    follows.c1.onResult({ status: JobStatus.COMPLETED, exit_code: 0 });

    expect(warn).toHaveBeenCalledOnce();
    expect(host._state).toBe("success");
    expect(flipped()).toBe(true);
    warn.mockRestore();
  });

  it("does not follow the upload when the compile fails", () => {
    const compile = makeJob({ job_id: "c1", job_type: JobType.COMPILE });
    const upload = makeJob({
      job_id: "u1",
      job_type: JobType.UPLOAD,
      status: JobStatus.QUEUED,
      depends_on: "c1",
    });
    const { host, follows, flipped } = makeHost(
      new Map([
        ["c1", compile],
        ["u1", upload],
      ])
    );

    host._jobId = "c1";
    followJob(host, "c1");
    follows.c1.onResult({ status: JobStatus.FAILED, exit_code: 1 });

    expect(host._state).toBe("error");
    expect(host._statusMessage).toBe("command.install_failed");
    expect(host._jobId).toBe("");
    expect(follows.u1).toBeUndefined();
    expect(flipped()).toBe(false);
  });

  it("build-locally stays in install mode and follows the new compile into its upload", async () => {
    // firmwareInstall returns a COMPILE after #1131; the override must not let
    // the dialog drop into compile mode (which would skip the upload chain).
    const jobs = new Map<string, FirmwareJob>();
    const newCompile = makeJob({
      job_id: "c2",
      job_type: JobType.COMPILE,
      status: JobStatus.QUEUED,
    });
    const newUpload = makeJob({
      job_id: "u2",
      job_type: JobType.UPLOAD,
      status: JobStatus.QUEUED,
      depends_on: "c2",
    });
    const { host, follows } = makeHost(jobs, {
      firmwareCancel: async () => {},
      stopStream: async () => {},
      firmwareInstall: async () => {
        jobs.set("c2", newCompile);
        jobs.set("u2", newUpload);
        return newCompile;
      },
    });
    host._jobId = "c1"; // the remote compile being cancelled

    await onForceLocalClick(host);

    expect(host._commandType).toBe("install");
    expect(host._jobId).toBe("c2");
    expect(follows.c2).toBeDefined();

    follows.c2.onResult({ status: JobStatus.COMPLETED, exit_code: 0 });
    expect(host._jobId).toBe("u2");
    expect(host._state).toBe("running");

    follows.u2.onResult({ status: JobStatus.COMPLETED, exit_code: 0 });
    expect(host._state).toBe("success");
    expect(host._statusMessage).toBe("command.install_success");
  });
});
