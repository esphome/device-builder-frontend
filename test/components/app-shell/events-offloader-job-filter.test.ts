import { describe, expect, it } from "vitest";
import { DeviceEventType } from "../../../src/api/types/event-subscription.js";
import { JobStatus, JobStream } from "../../../src/api/types/firmware-jobs.js";
import type {
  OffloaderJobOutputEventData,
  OffloaderJobStateChangedEventData,
} from "../../../src/api/types/remote-build-events.js";
import type { ESPHomeApp } from "../../../src/components/app-shell.js";
import { type InitialStateEventData } from "../../../src/api/types/event-subscription.js";
import { handleEvent } from "../../../src/components/app-shell/events.js";
import { handleJobEvent } from "../../../src/components/app-shell/jobs.js";
import { makeFirmwareJob } from "../../_make-firmware-job.js";

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

// The filter only reads _firmwareJobs keys, so the host models entries as
// bare { job_id } stubs instead of full FirmwareJob rows.
type Host = Pick<
  ESPHomeApp,
  "_buildOffloadJobs" | "_activeJobs" | "dismissRemoteBuildJob"
> & {
  _firmwareJobs: Map<string, { job_id: string }>;
};

function makeHost(firmwareJobIds: string[] = []): Host {
  const host: Host = {
    _buildOffloadJobs: new Map(),
    _activeJobs: new Map(),
    _firmwareJobs: new Map(firmwareJobIds.map((id) => [id, { job_id: id }])),
    // Eviction at ownership establishment routes through this host seam;
    // mirror the real method's row removal.
    dismissRemoteBuildJob: (job_id: string) => {
      const next = new Map(host._buildOffloadJobs);
      next.delete(job_id);
      host._buildOffloadJobs = next;
    },
  };
  return host;
}

describe("offloader job events skip locally-owned FirmwareJobs", () => {
  it("a wire-only job id still stubs a row", () => {
    const host = makeHost();
    handleEvent(
      host as unknown as ESPHomeApp,
      DeviceEventType.OFFLOADER_JOB_STATE_CHANGED,
      stateChanged("wire-1")
    );
    handleEvent(
      host as unknown as ESPHomeApp,
      DeviceEventType.OFFLOADER_JOB_OUTPUT,
      output("wire-1")
    );
    const row = host._buildOffloadJobs.get("wire-1");
    expect(row?.status).toBe(JobStatus.RUNNING);
    expect(row?.output).toEqual(["compiling...\n"]);
  });

  it("establishing ownership evicts a stubbed row without another wire event", () => {
    const host = makeHost();
    handleEvent(
      host as unknown as ESPHomeApp,
      DeviceEventType.OFFLOADER_JOB_STATE_CHANGED,
      stateChanged("fw-1")
    );
    expect(host._buildOffloadJobs.size).toBe(1);

    handleJobEvent(host as unknown as ESPHomeApp, "job_queued", {
      job_id: "fw-1",
      configuration: "kitchen.yaml",
      status: JobStatus.QUEUED,
    });

    expect(host._buildOffloadJobs.size).toBe(0);
  });

  it("a server-pinned install's wire echo never lands a ghost row", () => {
    // The remote-compile phase of a REMOTE-source FirmwareJob (pool-routed
    // or server-pinned) echoes wire events under the firmware job's id; the
    // firmware-job UI owns that lifecycle, so the offload list stays clear.
    const host = makeHost(["fw-1"]);
    handleEvent(
      host as unknown as ESPHomeApp,
      DeviceEventType.OFFLOADER_JOB_STATE_CHANGED,
      stateChanged("fw-1")
    );
    handleEvent(
      host as unknown as ESPHomeApp,
      DeviceEventType.OFFLOADER_JOB_OUTPUT,
      output("fw-1")
    );
    expect(host._buildOffloadJobs.size).toBe(0);
  });
});

// The cold-load eviction path: the initial_state remote_jobs merge runs
// after seedJobs and filters locally-owned ids. One assertion pins both
// the filter and the block ordering it depends on.
describe("initial_state remote_jobs merge skips locally-owned FirmwareJobs", () => {
  it("drops a snapshot row whose id the firmware snapshot owns", () => {
    const host = {
      _buildOffloadJobs: new Map(),
      _firmwareJobs: new Map(),
      _activeJobs: new Map(),
      // Fields the INITIAL_STATE handler writes unconditionally.
      _remoteBuildEnabled: false,
      _remoteBuildCleanupTtl: 0,
      _remoteBuildSetInFlight: false,
      _prefsLoaded: false,
      _prefsWritesInFlight: 0,
      _devices: [],
      _importableDevices: [],
      _devicesLoaded: false,
      _buildServerPeers: null,
      _buildOffloadDiscoveredHosts: null,
      _buildOffloadPairings: null,
      _offloaderWritesInFlight: 0,
      _buildOffloadAlerts: null,
      _offloaderRemoteBuildsEnabled: null,
      _offloaderVersionMatchPolicy: null,
      _offloaderIncludeLocalInPool: null,
    };

    handleEvent(host as unknown as ESPHomeApp, DeviceEventType.INITIAL_STATE, {
      devices: [],
      importable: [],
      firmware_jobs: [makeFirmwareJob({ job_id: "fw-1" })],
      remote_jobs: [
        {
          receiver_hostname: "192.168.1.50",
          receiver_port: 6052,
          pin_sha256: PIN,
          job_id: "fw-1",
          status: JobStatus.RUNNING,
          error_message: "",
        },
        {
          receiver_hostname: "192.168.1.50",
          receiver_port: 6052,
          pin_sha256: PIN,
          job_id: "wire-1",
          status: JobStatus.RUNNING,
          error_message: "",
        },
      ],
    } as unknown as InitialStateEventData);

    expect(host._buildOffloadJobs.has("fw-1")).toBe(false);
    expect(host._buildOffloadJobs.has("wire-1")).toBe(true);
  });
});
