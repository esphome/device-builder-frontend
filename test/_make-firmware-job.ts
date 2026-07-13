import {
  type FirmwareJob,
  JobSource,
  JobStatus,
  JobType,
} from "../src/api/types/firmware-jobs.js";

export function makeFirmwareJob(overrides: Partial<FirmwareJob> = {}): FirmwareJob {
  return {
    job_id: "job-1",
    configuration: "kitchen.yaml",
    job_type: JobType.COMPILE,
    status: JobStatus.QUEUED,
    created_at: "2026-01-01T00:00:00Z",
    started_at: null,
    completed_at: null,
    compile_started_at: null,
    compile_ended_at: null,
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
