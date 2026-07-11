/**
 * @vitest-environment happy-dom
 *
 * Reopening a deferred install from the firmware-tasks drawer goes through
 * the public followJob, which derives the command type from the job shape.
 * A deferred install is a lone COMPILE whose only install marker is
 * is_deferred_install — it must reopen as an Install and finish with the
 * queued-update message, not "Compilation complete!".
 */
import { describe, expect, it } from "vitest";
import {
  type FirmwareJob,
  JobStatus,
  JobType,
} from "../../src/api/types/firmware-jobs.js";
import { ESPHomeCommandDialog } from "../../src/components/command-dialog.js";
import { makeFirmwareJob } from "../_make-firmware-job.js";

interface StreamCbs {
  onOutput: (line: string) => void;
  onResult: (data: unknown) => void;
  onError: (error: string) => void;
}

interface Harness {
  _commandType: string;
  _state: string;
  _statusMessage: string;
  _jobs: Map<string, FirmwareJob>;
  _streamId: string;
  _api: unknown;
  followJob: (job: FirmwareJob, displayName: string) => void;
}

function mount(jobs: FirmwareJob[]) {
  const follows: Record<string, StreamCbs> = {};
  const el = new ESPHomeCommandDialog() as unknown as Harness;
  el._jobs = new Map(jobs.map((j) => [j.job_id, j]));
  el._streamId = "";
  el._api = {
    firmwareFollowJob: (jobId: string, cbs: StreamCbs): string => {
      follows[jobId] = cbs;
      return `stream-${jobId}`;
    },
    stopStream: () => Promise.resolve(),
  } as never;
  return { el, follows };
}

describe("command-dialog reopen of a deferred install", () => {
  it("derives install for a live deferred compile and finishes queued", () => {
    const compile = makeFirmwareJob({
      job_id: "c1",
      job_type: JobType.COMPILE,
      status: JobStatus.RUNNING,
      is_deferred_install: true,
    });
    const { el, follows } = mount([compile]);

    el.followJob(compile, "gen8266");
    expect(el._commandType).toBe("install");

    follows.c1.onResult({
      status: JobStatus.COMPLETED,
      exit_code: 0,
      is_deferred_install: true,
    });
    expect(el._state).toBe("success");
    expect(el._statusMessage).toBe("dashboard.queued_successfully");
  });

  it("derives install for a terminal deferred compile too", () => {
    const compile = makeFirmwareJob({
      job_id: "c1",
      job_type: JobType.COMPILE,
      status: JobStatus.COMPLETED,
      is_deferred_install: true,
    });
    const { el } = mount([compile]);

    el.followJob(compile, "gen8266");

    expect(el._commandType).toBe("install");
  });

  it("keeps a plain live compile deriving compile", () => {
    const compile = makeFirmwareJob({
      job_id: "c1",
      job_type: JobType.COMPILE,
      status: JobStatus.RUNNING,
    });
    const { el } = mount([compile]);

    el.followJob(compile, "gen8266");

    expect(el._commandType).toBe("compile");
  });
});
