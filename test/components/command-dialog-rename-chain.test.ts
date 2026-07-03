// A rename follows its COMPILE head into the dependent RENAME flash-and-swap
// tail: success is reported only after the flash, not when the compile ends.
import { describe, expect, it, vi } from "vitest";
import {
  type FirmwareJob,
  JobStatus,
  JobType,
} from "../../src/api/types/firmware-jobs.js";
import {
  deriveFollowCommandType,
  followJob,
} from "../../src/components/command-dialog/commands.js";
import { makeFirmwareJob as makeJob } from "../_make-firmware-job.js";
import { makeCommandDialogHost } from "./_command-dialog-host.js";

function makeHost(jobs: Map<string, FirmwareJob>) {
  return makeCommandDialogHost(
    jobs,
    {},
    {
      _commandType: "rename",
      configuration: "livingroom.yaml",
      name: "kitchen → livingroom",
    }
  );
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

describe("deriveFollowCommandType (reattach)", () => {
  it("derives the chain mode for a live compile head with a held dependent", () => {
    const { host } = renameChainHost();
    const jobs = (host as unknown as { _jobs: Map<string, FirmwareJob> })._jobs;

    expect(deriveFollowCommandType(jobs, jobs.get("c1")!)).toBe("rename");

    const upload = makeJob({
      job_id: "u1",
      job_type: JobType.UPLOAD,
      status: JobStatus.QUEUED,
      depends_on: "c2",
    });
    const compile = makeJob({ job_id: "c2", job_type: JobType.COMPILE });
    const installJobs = new Map([
      ["c2", compile],
      ["u1", upload],
    ]);
    expect(deriveFollowCommandType(installJobs, compile)).toBe("install");
  });

  it("keeps plain compile mode for terminal reattach and chainless compiles", () => {
    // Terminal reattach is a log-review path; it must not chain into the flash log.
    const done = makeJob({
      job_id: "c1",
      job_type: JobType.COMPILE,
      status: JobStatus.COMPLETED,
    });
    const tail = makeJob({
      job_id: "r1",
      job_type: JobType.RENAME,
      status: JobStatus.COMPLETED,
      new_name: "livingroom",
      depends_on: "c1",
    });
    const jobs = new Map([
      ["c1", done],
      ["r1", tail],
    ]);
    expect(deriveFollowCommandType(jobs, done)).toBe("compile");

    const lone = makeJob({ job_id: "c3", job_type: JobType.COMPILE });
    expect(deriveFollowCommandType(new Map([["c3", lone]]), lone)).toBe("compile");
  });

  it("maps non-compile jobs by type", () => {
    const tail = makeJob({
      job_id: "r1",
      job_type: JobType.RENAME,
      new_name: "livingroom",
      depends_on: "c1",
    });
    expect(deriveFollowCommandType(new Map(), tail)).toBe("rename");
  });
});
