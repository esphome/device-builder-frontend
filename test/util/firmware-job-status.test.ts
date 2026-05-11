import { describe, expect, it } from "vitest";
import { JobSource, JobStatus, JobType } from "../../src/api/types.js";
import type { FirmwareJob } from "../../src/api/types.js";
import {
  TERMINAL_JOB_STATUSES,
  isTerminalJob,
  isTerminalJobStatus,
} from "../../src/util/firmware-job-status.js";

/**
 * Build a structurally-accurate ``FirmwareJob`` for tests. Mirrors
 * the wire shape so a future rename / addition to the interface
 * makes the test fail to compile rather than silently drift behind
 * a forced cast.
 */
function job(overrides: Partial<FirmwareJob> = {}): FirmwareJob {
  return {
    job_id: "job-1",
    configuration: "test.yaml",
    job_type: JobType.INSTALL,
    status: JobStatus.QUEUED,
    created_at: "2026-05-04T12:00:00Z",
    started_at: null,
    completed_at: null,
    exit_code: null,
    output: [],
    error: null,
    port: "",
    new_name: "",
    progress: null,
    source: JobSource.LOCAL,
    source_pin_sha256: "",
    source_label: "",
    remote_peer: "",
    remote_peer_label: "",
    device_name: "",
    device_friendly_name: "",
    ...overrides,
  };
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
