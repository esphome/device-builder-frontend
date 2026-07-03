// A rename follows its COMPILE head into the dependent RENAME flash-and-swap
// tail: success is reported only after the flash, not when the compile ends.
import { describe, expect, it, vi } from "vitest";
import {
  type FirmwareJob,
  JobStatus,
  JobType,
} from "../../src/api/types/firmware-jobs.js";
import type { ESPHomeCommandDialog } from "../../src/components/command-dialog.js";
import { followJob } from "../../src/components/command-dialog/commands.js";
import { makeFirmwareJob as makeJob } from "../_make-firmware-job.js";

interface StreamCbs {
  onOutput: (line: string) => void;
  onResult: (data: unknown) => void;
  onError: (error: string) => void;
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
    _commandType: "rename",
    _jobId: "",
    _jobStatus: JobStatus.RUNNING,
    _state: "running",
    _statusMessage: "",
    _streamId: "",
    configuration: "livingroom.yaml",
    name: "kitchen → livingroom",
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

// A COMPILE head "c1" of the renamed YAML plus its held RENAME tail "r1".
function renameChainHost() {
  const compile = makeJob({
    job_id: "c1",
    job_type: JobType.COMPILE,
    configuration: "livingroom.yaml",
  });
  const tail = makeJob({
    job_id: "r1",
    job_type: JobType.RENAME,
    configuration: "kitchen.yaml",
    new_name: "livingroom",
    status: JobStatus.QUEUED,
    depends_on: "c1",
  });
  return {
    ...makeHost(
      new Map([
        ["c1", compile],
        ["r1", tail],
      ])
    ),
    compile,
    tail,
  };
}

describe("command-dialog rename chain follow", () => {
  it("follows the compile into the rename tail and only succeeds after it", () => {
    const { host, follows, flipped } = renameChainHost();

    host._jobId = "c1";
    followJob(host, "c1");
    follows.c1.onResult({ status: JobStatus.COMPLETED, exit_code: 0 });

    expect(host._state).toBe("running");
    expect(host._jobId).toBe("r1");
    expect(follows.r1).toBeDefined();

    follows.r1.onResult({ status: JobStatus.COMPLETED, exit_code: 0 });

    expect(host._state).toBe("success");
    expect(host._statusMessage).toBe("command.rename_success");
    expect(host._jobId).toBe("");
    // Post-rename the device announces under a new name — no log flip.
    expect(flipped()).toBe(false);
  });

  it("does not follow the tail when the compile fails", () => {
    const { host, follows } = renameChainHost();

    host._jobId = "c1";
    followJob(host, "c1");
    follows.c1.onResult({ status: JobStatus.FAILED, exit_code: 1 });

    expect(host._state).toBe("error");
    expect(host._statusMessage).toBe("command.rename_failed");
    expect(follows.r1).toBeUndefined();
  });

  it("warns and fails when the compile has no dependent tail", () => {
    const compile = makeJob({ job_id: "c1", job_type: JobType.COMPILE });
    const { host, follows } = makeHost(new Map([["c1", compile]]));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    host._jobId = "c1";
    followJob(host, "c1");
    follows.c1.onResult({ status: JobStatus.COMPLETED, exit_code: 0 });

    expect(warn).toHaveBeenCalledOnce();
    expect(host._state).toBe("error");
    expect(host._statusMessage).toBe("command.rename_failed");
    warn.mockRestore();
  });

  it("reports the tail's failure as a rename failure", () => {
    const { host, follows } = renameChainHost();

    host._jobId = "c1";
    followJob(host, "c1");
    follows.c1.onResult({ status: JobStatus.COMPLETED, exit_code: 0 });
    follows.r1.onResult({ status: JobStatus.FAILED, exit_code: 1 });

    expect(host._state).toBe("error");
    expect(host._statusMessage).toBe("command.rename_failed");
  });
});
