// Install follows the COMPILE then its dependent UPLOAD (#1131): success is
// reported only after the upload, not when the compile finishes.
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
import { makeFirmwareJob as makeJob } from "../_make-firmware-job.js";

interface StreamCbs {
  onOutput: (line: string) => void;
  onResult: (data: unknown) => void;
  onError: (error: string) => void;
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
    _userStopped: false,
    _failedDuringValidate: false,
    _installMissingUpload: false,
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

// A host pre-loaded with an install chain: a COMPILE "c1" and its held UPLOAD
// "u1" (depends_on "c1"). Overrides tweak either job (e.g. a REMOTE compile).
function installChainHost(
  compileOverrides: Partial<FirmwareJob> = {},
  uploadOverrides: Partial<FirmwareJob> = {}
) {
  const compile = makeJob({
    job_id: "c1",
    job_type: JobType.COMPILE,
    ...compileOverrides,
  });
  const upload = makeJob({
    job_id: "u1",
    job_type: JobType.UPLOAD,
    status: JobStatus.QUEUED,
    depends_on: "c1",
    ...uploadOverrides,
  });
  return {
    ...makeHost(
      new Map([
        ["c1", compile],
        ["u1", upload],
      ])
    ),
    compile,
    upload,
  };
}

describe("command-dialog install chain follow", () => {
  it("follows the compile into its upload and only succeeds after the upload", () => {
    const { host, follows, flipped } = installChainHost();

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

  it("warns and fails (not success) when a compile has no dependent upload", () => {
    const compile = makeJob({ job_id: "c1", job_type: JobType.COMPILE });
    // No upload in context — a genuine backend/transport gap, not the happy path.
    const { host, follows, flipped } = makeHost(new Map([["c1", compile]]));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    host._jobId = "c1";
    followJob(host, "c1");
    follows.c1.onResult({ status: JobStatus.COMPLETED, exit_code: 0 });

    expect(warn).toHaveBeenCalledOnce();
    // The device was never flashed — must not report a successful install.
    expect(host._state).toBe("error");
    expect(host._statusMessage).toBe("command.install_failed");
    // Flagged so the clean/reset build-failure hint is suppressed (compile was fine).
    expect(host._installMissingUpload).toBe(true);
    expect(flipped()).toBe(false);
    warn.mockRestore();
  });

  it("re-primes the build source from the upload on hand-off", () => {
    // The compile ran on a remote builder; the upload is local. After hand-off
    // the primed source must track the upload so the remote-builder sub-line
    // doesn't linger on the compile's receiver.
    const { host, follows } = installChainHost({
      source: JobSource.REMOTE,
      source_label: "builder",
    });
    host._primedSource = {
      source: JobSource.REMOTE,
      source_label: "builder",
      source_esphome_version: "",
    };

    host._jobId = "c1";
    followJob(host, "c1");
    follows.c1.onResult({ status: JobStatus.COMPLETED, exit_code: 0 });

    expect(host._primedSource?.source).toBe(JobSource.LOCAL);
    expect(host._primedSource?.source_label).toBe("");
  });

  it("does not follow the upload when the compile fails", () => {
    const { host, follows, flipped } = installChainHost();

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
    // Stale per-session flags from the cancelled remote attempt.
    host._userStopped = true;
    host._failedDuringValidate = true;
    host._installMissingUpload = true;

    await onForceLocalClick(host);

    expect(host._commandType).toBe("install");
    expect(host._jobId).toBe("c2");
    expect(follows.c2).toBeDefined();
    // The new local run starts clean — stale flags can't mis-route its hint.
    expect(host._userStopped).toBe(false);
    expect(host._failedDuringValidate).toBe(false);
    expect(host._installMissingUpload).toBe(false);

    follows.c2.onResult({ status: JobStatus.COMPLETED, exit_code: 0 });
    expect(host._jobId).toBe("u2");
    expect(host._state).toBe("running");

    follows.u2.onResult({ status: JobStatus.COMPLETED, exit_code: 0 });
    expect(host._state).toBe("success");
    expect(host._statusMessage).toBe("command.install_success");
  });
});
