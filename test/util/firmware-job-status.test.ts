import { describe, expect, it } from "vitest";
import { JobStatus } from "../../src/api/types.js";
import type { FirmwareJob } from "../../src/api/types.js";
import {
  TERMINAL_JOB_STATUSES,
  isTerminalJob,
  isTerminalJobStatus,
} from "../../src/util/firmware-job-status.js";

function job(overrides: Partial<FirmwareJob> = {}): FirmwareJob {
  return {
    job_id: "job-1",
    job_type: "install" as FirmwareJob["job_type"],
    configuration: "test.yaml",
    status: JobStatus.QUEUED,
    progress: null,
    queued_at: 0,
    started_at: null,
    finished_at: null,
    exit_code: null,
    port: null,
    new_name: null,
    error: null,
    ...overrides,
  } as FirmwareJob;
}

describe("TERMINAL_JOB_STATUSES", () => {
  it("contains exactly COMPLETED, FAILED, CANCELLED", () => {
    expect(TERMINAL_JOB_STATUSES.has(JobStatus.COMPLETED)).toBe(true);
    expect(TERMINAL_JOB_STATUSES.has(JobStatus.FAILED)).toBe(true);
    expect(TERMINAL_JOB_STATUSES.has(JobStatus.CANCELLED)).toBe(true);
    expect(TERMINAL_JOB_STATUSES.has(JobStatus.QUEUED)).toBe(false);
    expect(TERMINAL_JOB_STATUSES.has(JobStatus.RUNNING)).toBe(false);
    expect(TERMINAL_JOB_STATUSES.size).toBe(3);
  });
});

describe("isTerminalJobStatus", () => {
  it("returns true for terminal statuses", () => {
    expect(isTerminalJobStatus(JobStatus.COMPLETED)).toBe(true);
    expect(isTerminalJobStatus(JobStatus.FAILED)).toBe(true);
    expect(isTerminalJobStatus(JobStatus.CANCELLED)).toBe(true);
  });

  it("returns false for in-flight statuses", () => {
    expect(isTerminalJobStatus(JobStatus.QUEUED)).toBe(false);
    expect(isTerminalJobStatus(JobStatus.RUNNING)).toBe(false);
  });

  it("returns false for null / undefined (status not yet observed)", () => {
    // The dialog's _jobStatus starts at null until followJob() / open()
    // primes it. Treat that as 'not terminal' so the caller waits.
    expect(isTerminalJobStatus(null)).toBe(false);
    expect(isTerminalJobStatus(undefined)).toBe(false);
  });
});

describe("isTerminalJob", () => {
  it("delegates to the job's status", () => {
    expect(isTerminalJob(job({ status: JobStatus.COMPLETED }))).toBe(true);
    expect(isTerminalJob(job({ status: JobStatus.FAILED }))).toBe(true);
    expect(isTerminalJob(job({ status: JobStatus.CANCELLED }))).toBe(true);
    expect(isTerminalJob(job({ status: JobStatus.QUEUED }))).toBe(false);
    expect(isTerminalJob(job({ status: JobStatus.RUNNING }))).toBe(false);
  });
});
