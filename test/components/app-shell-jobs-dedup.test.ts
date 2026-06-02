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
