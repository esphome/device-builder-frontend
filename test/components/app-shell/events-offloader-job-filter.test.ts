import { describe, expect, it } from "vitest";
import { DeviceEventType } from "../../../src/api/types/event-subscription.js";
import { JobStatus, JobStream } from "../../../src/api/types/firmware-jobs.js";
import type {
  OffloaderJobOutputEventData,
  OffloaderJobStateChangedEventData,
} from "../../../src/api/types/remote-build-events.js";
import type { ESPHomeApp } from "../../../src/components/app-shell.js";
import { handleEvent } from "../../../src/components/app-shell/events.js";

const PIN = "a".repeat(64);

function stateChanged(job_id: string): OffloaderJobStateChangedEventData {
  return {
    receiver_hostname: "192.168.1.50",
    receiver_port: 6052,
    pin_sha256: PIN,
    job_id,
    status: JobStatus.RUNNING,
    error_message: "",
  };
}

function output(job_id: string): OffloaderJobOutputEventData {
  return {
    receiver_hostname: "192.168.1.50",
    receiver_port: 6052,
    pin_sha256: PIN,
    job_id,
    stream: JobStream.STDOUT,
    line: "compiling...\n",
  };
}

type Host = Pick<ESPHomeApp, "_buildOffloadJobs" | "_firmwareJobs">;

function makeHost(firmwareJobIds: string[] = []): Host {
  return {
    _buildOffloadJobs: new Map(),
    _firmwareJobs: new Map(firmwareJobIds.map((id) => [id, { job_id: id } as never])),
  };
}

describe("offloader job events skip locally-owned FirmwareJobs", () => {
  it("a wire-only job id still stubs a row", () => {
    const host = makeHost();
    handleEvent(
      host as ESPHomeApp,
      DeviceEventType.OFFLOADER_JOB_STATE_CHANGED,
      stateChanged("wire-1")
    );
    handleEvent(
      host as ESPHomeApp,
      DeviceEventType.OFFLOADER_JOB_OUTPUT,
      output("wire-1")
    );
    const row = host._buildOffloadJobs.get("wire-1");
    expect(row?.status).toBe(JobStatus.RUNNING);
    expect(row?.output).toEqual(["compiling...\n"]);
  });

  it("a server-pinned install's wire echo never lands a ghost row", () => {
    // The remote-compile phase of a REMOTE-source FirmwareJob (pool-routed
    // or server-pinned) echoes wire events under the firmware job's id; the
    // firmware-job UI owns that lifecycle, so the offload list stays clear.
    const host = makeHost(["fw-1"]);
    handleEvent(
      host as ESPHomeApp,
      DeviceEventType.OFFLOADER_JOB_STATE_CHANGED,
      stateChanged("fw-1")
    );
    handleEvent(host as ESPHomeApp, DeviceEventType.OFFLOADER_JOB_OUTPUT, output("fw-1"));
    expect(host._buildOffloadJobs.size).toBe(0);
  });
});
