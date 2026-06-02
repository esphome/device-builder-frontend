/**
 * Install follows the COMPILE then its dependent UPLOAD (backend #1131).
 *
 * firmware/install returns the COMPILE job; the UPLOAD is held off its lane
 * (depends_on === compile job_id) until the compile succeeds, then flashes.
 * followJob must hand off to the upload on a successful compile and only
 * report success once the upload finishes, instead of declaring the device
 * flashed the moment it compiled.
 */
import { describe, expect, it } from "vitest";
import {
  type FirmwareJob,
  JobSource,
  JobStatus,
  JobType,
} from "../../src/api/types/firmware-jobs.js";
import type { ESPHomeCommandDialog } from "../../src/components/command-dialog.js";
import { followJob } from "../../src/components/command-dialog/commands.js";

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

function makeHost(jobs: Map<string, FirmwareJob>) {
  const follows: Record<string, StreamCbs> = {};
  let flipped = false;
  let streamSeq = 0;
  const host = {
    _api: {
      firmwareFollowJob: (jobId: string, cbs: StreamCbs): string => {
        follows[jobId] = cbs;
        return `stream-${++streamSeq}`;
      },
    },
    _jobs: jobs,
    _commandType: "install",
    _jobId: "",
    _jobStatus: JobStatus.RUNNING,
    _state: "running",
    _statusMessage: "",
    _streamId: "",
    _showLogsAfterInstall: true,
    _failedDuringValidate: false,
    _localize: (key: string) => key,
    _flipToLogs: () => {
      flipped = true;
    },
    _flushPendingLines: () => {},
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
});
