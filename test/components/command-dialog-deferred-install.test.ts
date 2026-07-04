// A deferred install's COMPILE has no dependent flash; is_deferred_install on
// the terminal result reports queued success instead of the missing-flash error.
import { describe, expect, it, vi } from "vitest";
import { JobStatus, JobType } from "../../src/api/types/firmware-jobs.js";
import { followJob } from "../../src/components/command-dialog/commands.js";
import { makeFirmwareJob as makeJob } from "../_make-firmware-job.js";
import { makeCommandDialogHost as makeHost } from "./_command-dialog-host.js";

function lonelyCompileHost() {
  const compile = makeJob({ job_id: "c1", job_type: JobType.COMPILE });
  return makeHost(new Map([["c1", compile]]));
}

describe("command-dialog deferred install follow", () => {
  it("reports queued success when the compile was a deferred install", () => {
    const { host, follows } = lonelyCompileHost();
    host._jobId = "c1";
    followJob(host, "c1");
    follows.c1.onResult({
      status: JobStatus.COMPLETED,
      exit_code: 0,
      is_deferred_install: true,
    });

    expect(host._state).toBe("success");
    expect(host._statusMessage).toBe("dashboard.queued_successfully");
    expect(host._jobId).toBe("");
  });

  it("keeps the missing-dependent error for a non-deferred compile", () => {
    const { host, follows } = lonelyCompileHost();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    host._jobId = "c1";
    followJob(host, "c1");
    follows.c1.onResult({ status: JobStatus.COMPLETED, exit_code: 0 });

    expect(host._state).toBe("error");
    expect(host._compileMissingDependent).toBe(true);
    warn.mockRestore();
  });
});
