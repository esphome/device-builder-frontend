// A deferred install's COMPILE has no dependent flash; queued_update_armed on
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
      queued_update_armed: true,
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

  it("reports queued without priming into the cancelled upload of a converted chain", () => {
    // The backend cancels the held upload when the device goes offline
    // mid-build; the compile's queued result must win over the flash chase.
    const compile = makeJob({ job_id: "c1", job_type: JobType.COMPILE });
    const upload = makeJob({
      job_id: "u1",
      job_type: JobType.UPLOAD,
      depends_on: "c1",
      status: JobStatus.CANCELLED,
    });
    const { host, follows } = makeHost(
      new Map([
        ["c1", compile],
        ["u1", upload],
      ])
    );
    host._jobId = "c1";
    followJob(host, "c1");
    follows.c1.onResult({
      status: JobStatus.COMPLETED,
      exit_code: 0,
      queued_update_armed: true,
    });

    expect(host._state).toBe("success");
    expect(host._statusMessage).toBe("dashboard.queued_successfully");
    expect(follows.u1).toBeUndefined();
  });

  it("reports queued for an OTA upload that failed against an offline device", () => {
    const upload = makeJob({ job_id: "u1", job_type: JobType.UPLOAD, port: "OTA" });
    const { host, follows } = makeHost(new Map([["u1", upload]]));
    host._jobId = "u1";
    followJob(host, "u1");
    follows.u1.onResult({
      status: JobStatus.FAILED,
      exit_code: 1,
      queued_update_armed: true,
    });

    expect(host._state).toBe("success");
    expect(host._statusMessage).toBe("dashboard.queued_successfully");
  });

  it("keeps an unflagged failure an error", () => {
    const { host, follows } = lonelyCompileHost();
    host._jobId = "c1";
    followJob(host, "c1");
    follows.c1.onResult({ status: JobStatus.FAILED, exit_code: 1 });

    expect(host._state).toBe("error");
    expect(host._statusMessage).toBe("command.install_failed");
  });
});
