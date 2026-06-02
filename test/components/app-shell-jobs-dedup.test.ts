/**
 * Terminal-job dedup in the live jobs context keys on (config, type).
 *
 * An install is a COMPILE then a dependent UPLOAD sharing a configuration
 * (backend #1131). Dedup-per-config-alone let the upload's completion evict
 * the compile from the live list (the build log vanished until a reload).
 * Keying on type too keeps both, matching the backend's retention.
 */
import { describe, expect, it } from "vitest";
import {
  type FirmwareJob,
  JobSource,
  JobStatus,
  JobType,
} from "../../src/api/types/firmware-jobs.js";
import type { ESPHomeApp } from "../../src/components/app-shell.js";
import { handleJobEvent } from "../../src/components/app-shell/jobs.js";

function makeJob(overrides: Partial<FirmwareJob> = {}): FirmwareJob {
  return {
    job_id: "job-1",
    configuration: "kitchen.yaml",
    job_type: JobType.COMPILE,
    status: JobStatus.COMPLETED,
    created_at: "2026-01-01T00:00:00Z",
    started_at: null,
    completed_at: null,
    exit_code: null,
    output: [],
    error: null,
    port: "OTA",
    new_name: "",
    depends_on: "",
    progress: null,
    source: JobSource.LOCAL,
    source_pin_sha256: "",
    source_label: "",
    source_esphome_version: "",
    remote_peer: "",
    remote_peer_label: "",
    device_name: "",
    device_friendly_name: "",
    ...overrides,
  };
}

function makeHost(): ESPHomeApp {
  return {
    _firmwareJobs: new Map(),
    _activeJobs: new Map(),
    _recentJobs: new Map(),
    _recentJobTimers: new Map(),
  } as unknown as ESPHomeApp;
}

describe("live jobs dedup (config, type)", () => {
  it("keeps an install's compile and upload terminals for the same config", () => {
    const host = makeHost();
    handleJobEvent(
      host,
      "job_completed",
      makeJob({ job_id: "c", job_type: JobType.COMPILE })
    );
    handleJobEvent(
      host,
      "job_completed",
      makeJob({ job_id: "u", job_type: JobType.UPLOAD, depends_on: "c" })
    );
    expect(new Set(host._firmwareJobs.keys())).toEqual(new Set(["c", "u"]));
  });

  it("still collapses two compiles for the same config to the newest", () => {
    const host = makeHost();
    handleJobEvent(
      host,
      "job_completed",
      makeJob({ job_id: "c1", job_type: JobType.COMPILE })
    );
    handleJobEvent(
      host,
      "job_completed",
      makeJob({ job_id: "c2", job_type: JobType.COMPILE })
    );
    expect(new Set(host._firmwareJobs.keys())).toEqual(new Set(["c2"]));
  });
});
