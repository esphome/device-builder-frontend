// Live-jobs dedup keys on (config, type) so an install's compile and upload
// both survive — the upload's terminal must not evict the compile (#1131).
import { describe, expect, it } from "vitest";
import { JobStatus, JobType } from "../../src/api/types/firmware-jobs.js";
import type { ESPHomeApp } from "../../src/components/app-shell.js";
import { handleJobEvent } from "../../src/components/app-shell/jobs.js";
import { makeFirmwareJob as makeJob } from "../_make-firmware-job.js";

function makeHost(): ESPHomeApp {
  return {
    _firmwareJobs: new Map(),
    _activeJobs: new Map(),
    _recentJobs: new Map(),
    _recentJobTimers: new Map(),
  } as unknown as ESPHomeApp;
}

const done = (overrides: Parameters<typeof makeJob>[0]) =>
  makeJob({ status: JobStatus.COMPLETED, ...overrides });

describe("live jobs dedup (config, type)", () => {
  it("keeps an install's compile and upload terminals for the same config", () => {
    const host = makeHost();
    handleJobEvent(
      host,
      "job_completed",
      done({ job_id: "c", job_type: JobType.COMPILE })
    );
    handleJobEvent(
      host,
      "job_completed",
      done({ job_id: "u", job_type: JobType.UPLOAD, depends_on: "c" })
    );
    expect(new Set(host._firmwareJobs.keys())).toEqual(new Set(["c", "u"]));
  });

  it("still collapses two compiles for the same config to the newest", () => {
    const host = makeHost();
    handleJobEvent(
      host,
      "job_completed",
      done({ job_id: "c1", job_type: JobType.COMPILE })
    );
    handleJobEvent(
      host,
      "job_completed",
      done({ job_id: "c2", job_type: JobType.COMPILE })
    );
    expect(new Set(host._firmwareJobs.keys())).toEqual(new Set(["c2"]));
  });
});

// Stopping an install's compile cancels its dependent upload in the same
// cascade. The compile's cancel arrives while the upload is still queued, which
// the supersede branch mistook for a live successor and returned early without
// releasing the card's active slot — leaving it stuck "Installing" (#1482).
describe("stop during install releases the device's active slot", () => {
  const CFG = "kitchen.yaml";
  const queued = (o: Parameters<typeof makeJob>[0]) =>
    makeJob({ configuration: CFG, status: JobStatus.QUEUED, ...o });

  it("clears the active slot when a stopped compile cascades onto its upload", () => {
    const host = makeHost();
    // Install enqueues compile + dependent upload (upload queued first), then
    // the compile starts and becomes the latched active job.
    handleJobEvent(
      host,
      "job_queued",
      queued({ job_id: "u", job_type: JobType.UPLOAD, depends_on: "c" })
    );
    handleJobEvent(
      host,
      "job_queued",
      queued({ job_id: "c", job_type: JobType.COMPILE })
    );
    handleJobEvent(
      host,
      "job_started",
      queued({ job_id: "c", job_type: JobType.COMPILE, status: JobStatus.RUNNING })
    );
    expect(host._activeJobs.get(CFG)?.job_id).toBe("c");

    handleJobEvent(
      host,
      "job_cancelled",
      queued({ job_id: "c", job_type: JobType.COMPILE, status: JobStatus.CANCELLED })
    );
    handleJobEvent(
      host,
      "job_cancelled",
      queued({
        job_id: "u",
        job_type: JobType.UPLOAD,
        depends_on: "c",
        status: JobStatus.CANCELLED,
      })
    );
    expect(host._activeJobs.has(CFG)).toBe(false);
  });

  it("keeps a live successor's slot when an older job is cancelled", () => {
    const host = makeHost();
    handleJobEvent(
      host,
      "job_started",
      queued({ job_id: "old", job_type: JobType.COMPILE, status: JobStatus.RUNNING })
    );
    handleJobEvent(
      host,
      "job_queued",
      queued({ job_id: "new", job_type: JobType.COMPILE })
    );
    expect(host._activeJobs.get(CFG)?.job_id).toBe("new");

    handleJobEvent(
      host,
      "job_cancelled",
      queued({ job_id: "old", job_type: JobType.COMPILE, status: JobStatus.CANCELLED })
    );
    expect(host._activeJobs.get(CFG)?.job_id).toBe("new");
  });
});
