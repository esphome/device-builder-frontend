// A deferred install's COMPILE has no dependent flash; queued_update_armed on
// the terminal result reports queued success instead of the missing-flash error.
import { describe, expect, it, vi } from "vitest";
import { makeConfiguredDevice } from "../_make-configured-device.js";
import { makeFirmwareJob as makeJob } from "../_make-firmware-job.js";
import type { FirmwareJob } from "../../src/api/types/firmware-jobs.js";
import { JobStatus, JobType } from "../../src/api/types/firmware-jobs.js";
import type { CommandType } from "../../src/components/command-dialog.js";
import {
  followJob,
  maybeFollowWakeUpload,
} from "../../src/components/command-dialog/commands.js";
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
    const upload = makeJob({ job_id: "u1", job_type: JobType.UPLOAD });
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
    // Armed against its own stale jobs-context entry, not re-followed.
    expect(host._awaitingWakeAfter).toBe("u1");
    expect(host._jobId).toBe("");
    expect(host._streamId).toBe("");
  });

  it("tells a never-flashed device's owner to plug in via USB", () => {
    const { host, follows } = lonelyCompileHost();
    // makeConfiguredDevice defaults are UNKNOWN + no deploy evidence.
    host._devices = [makeConfiguredDevice()];
    host._jobId = "c1";
    followJob(host, "c1");
    follows.c1.onResult({
      status: JobStatus.COMPLETED,
      exit_code: 0,
      queued_update_armed: true,
    });

    expect(host._state).toBe("success");
    expect(host._statusMessage).toBe("dashboard.queued_first_install");
  });

  it("keeps the generic queued copy once the device has deploy evidence", () => {
    const { host, follows } = lonelyCompileHost();
    host._devices = [
      makeConfiguredDevice({ runtime_state: { deployed_version: "2026.6.0" } }),
    ];
    host._jobId = "c1";
    followJob(host, "c1");
    follows.c1.onResult({
      status: JobStatus.COMPLETED,
      exit_code: 0,
      queued_update_armed: true,
    });

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

describe("command-dialog wake re-follow", () => {
  const wakeUpload = (overrides: Partial<FirmwareJob> = {}) =>
    makeJob({
      job_id: "u2",
      job_type: JobType.UPLOAD,
      status: JobStatus.QUEUED,
      ...overrides,
    });

  function queuedHost(opts: { commandType?: CommandType; seedUpload?: boolean } = {}) {
    const bundle = lonelyCompileHost();
    bundle.host._commandType = opts.commandType ?? "install";
    bundle.host._jobId = "c1";
    followJob(bundle.host, "c1");
    if (opts.seedUpload) bundle.host._jobs.set("u2", wakeUpload());
    bundle.follows.c1.onResult({
      status: JobStatus.COMPLETED,
      exit_code: 0,
      queued_update_armed: true,
    });
    return bundle;
  }

  const arrive = (
    host: ReturnType<typeof queuedHost>["host"],
    overrides: Partial<FirmwareJob> = {}
  ) => {
    const job = wakeUpload(overrides);
    host._jobs.set(job.job_id, job);
    maybeFollowWakeUpload(host);
  };

  it("re-follows the wake flash and flips to logs on its success", () => {
    const { host, follows, flipped } = queuedHost();
    expect(host._awaitingWakeAfter).toBe("c1");

    arrive(host);

    expect(host._awaitingWakeAfter).toBe("");
    expect(host._state).toBe("running");
    expect(host._jobId).toBe("u2");
    expect(host._timerJobId).toBe("u2");
    expect(follows.u2).toBeDefined();

    follows.u2.onResult({ status: JobStatus.COMPLETED, exit_code: 0 });
    expect(host._state).toBe("success");
    expect(host._statusMessage).toBe("command.install_success");
    expect(flipped()).toBe(true);
  });

  it.each([
    ["another configuration's upload", { configuration: "porch.yaml" }],
    ["a chained upload held behind a compile", { depends_on: "c9" }],
    ["a terminal upload", { status: JobStatus.CANCELLED }],
    ["a serial upload", { port: "/dev/ttyUSB0" }],
  ])("ignores %s", (_name, overrides) => {
    const { host, follows } = queuedHost();
    arrive(host, overrides);

    expect(host._awaitingWakeAfter).toBe("c1");
    expect(follows.u2).toBeUndefined();
  });

  it("does nothing once the dialog is closed", () => {
    const { host, follows } = queuedHost();
    host._open = false;
    arrive(host);

    expect(follows.u2).toBeUndefined();
  });

  it("never arms on a firmware-tasks reattach (offline_compile)", () => {
    const { host } = queuedHost({ commandType: "offline_compile" });

    expect(host._awaitingWakeAfter).toBe("");
  });

  it("never arms on a reattach to an already-terminal job", () => {
    const { host, follows } = lonelyCompileHost();
    host._jobStatus = JobStatus.COMPLETED;
    host._jobId = "c1";
    followJob(host, "c1");
    follows.c1.onResult({
      status: JobStatus.COMPLETED,
      exit_code: 0,
      queued_update_armed: true,
    });

    expect(host._awaitingWakeAfter).toBe("");
    expect(host._statusMessage).toBe("dashboard.queued_successfully");
  });

  it("re-arms when the wake flash fails against a re-slept device", () => {
    const { host, follows } = queuedHost();
    arrive(host);

    follows.u2.onResult({
      status: JobStatus.FAILED,
      exit_code: 1,
      queued_update_armed: true,
    });
    expect(host._state).toBe("success");
    expect(host._statusMessage).toBe("dashboard.queued_successfully");
    expect(host._awaitingWakeAfter).toBe("u2");
  });

  it("follows an upload already live when the queued result lands", () => {
    const { host, follows } = queuedHost({ seedUpload: true });

    expect(host._state).toBe("running");
    expect(host._jobId).toBe("u2");
    expect(follows.u2).toBeDefined();
  });
});
