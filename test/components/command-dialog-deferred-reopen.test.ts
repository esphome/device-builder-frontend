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
import { JobStatus, JobType } from "../../src/api/types/firmware-jobs.js";
import { ESPHomeCommandDialog } from "../../src/components/command-dialog.js";
import { deriveFollowCommandType } from "../../src/components/command-dialog/commands.js";
import { makeFirmwareJob } from "../_make-firmware-job.js";
import type { StreamCbs } from "./_command-dialog-host.js";

function mount(jobs: ReturnType<typeof makeFirmwareJob>[]) {
  const follows: Record<string, StreamCbs> = {};
  const el = new ESPHomeCommandDialog();
  el._jobs = new Map(jobs.map((j) => [j.job_id, j]));
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
  it("reopens as an install and finishes queued", () => {
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
      queued_update_armed: true,
    });
    expect(el._state).toBe("success");
    expect(el._statusMessage).toBe("dashboard.queued_successfully");
  });
});

describe("deriveFollowCommandType for deferred installs", () => {
  it("derives install for a terminal deferred compile", () => {
    const compile = makeFirmwareJob({
      job_type: JobType.COMPILE,
      status: JobStatus.COMPLETED,
      is_deferred_install: true,
    });
    expect(deriveFollowCommandType(new Map(), compile)).toBe("install");
  });

  it("keeps a plain compile deriving compile", () => {
    const compile = makeFirmwareJob({
      job_type: JobType.COMPILE,
      status: JobStatus.RUNNING,
    });
    expect(deriveFollowCommandType(new Map(), compile)).toBe("compile");
  });
});
