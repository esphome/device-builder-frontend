// Pins what initial_state seeds for the Build server panel's first
// paint: the receiver settings scalars (no disabled-CTA flash) and the
// one-shot firmware-jobs snapshot (no per-frame queue buildup).

import { describe, expect, it } from "vitest";
import {
  DeviceEventType,
  type InitialStateEventData,
} from "../../../src/api/types/event-subscription.js";
import { CLEANUP_TTL_DEFAULT_SECONDS } from "../../../src/api/types/remote-build.js";
import { JobStatus, JobType } from "../../../src/api/types/firmware-jobs.js";
import type { ESPHomeApp } from "../../../src/components/app-shell.js";
import { handleEvent } from "../../../src/components/app-shell/events.js";
import { makeFirmwareJob } from "../../_make-firmware-job.js";

type Host = { [key: string]: unknown } & Pick<
  ESPHomeApp,
  | "_remoteBuildEnabled"
  | "_remoteBuildCleanupTtl"
  | "_remoteBuildSetInFlight"
  | "_firmwareJobs"
  | "_activeJobs"
>;

function makeHost(): Host {
  return {
    _remoteBuildEnabled: false,
    _remoteBuildCleanupTtl: CLEANUP_TTL_DEFAULT_SECONDS,
    _remoteBuildSetInFlight: false,
    _firmwareJobs: new Map(),
    _activeJobs: new Map(),
    // Fields the INITIAL_STATE handler writes unconditionally.
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
  } as unknown as Host;
}

function dispatch(host: Host, data: Partial<InitialStateEventData>): void {
  handleEvent(host as unknown as ESPHomeApp, DeviceEventType.INITIAL_STATE, {
    devices: [],
    importable: [],
    ...data,
  } as InitialStateEventData);
}

describe("handleEvent INITIAL_STATE panel seeds", () => {
  it("seeds the receiver settings scalars", () => {
    const host = makeHost();
    dispatch(host, {
      remote_build_settings: { enabled: true, cleanup_ttl_seconds: 7200 },
    });
    expect(host._remoteBuildEnabled).toBe(true);
    expect(host._remoteBuildCleanupTtl).toBe(7200);
  });

  it("keeps the optimistic value while a settings write is in flight", () => {
    const host = makeHost();
    host._remoteBuildEnabled = true;
    host._remoteBuildSetInFlight = true;
    dispatch(host, {
      remote_build_settings: { enabled: false, cleanup_ttl_seconds: 3600 },
    });
    expect(host._remoteBuildEnabled).toBe(true);
  });

  it("leaves the defaults alone when the receiver controller is absent", () => {
    const host = makeHost();
    dispatch(host, {});
    expect(host._remoteBuildEnabled).toBe(false);
    expect(host._remoteBuildCleanupTtl).toBe(CLEANUP_TTL_DEFAULT_SECONDS);
  });

  it("keeps a job a follow_jobs frame delivered ahead of the snapshot", () => {
    const host = makeHost();
    const raced = makeFirmwareJob({
      job_id: "j-new",
      configuration: "c.yaml",
      job_type: JobType.COMPILE,
      status: JobStatus.QUEUED,
    });
    host._firmwareJobs = new Map([[raced.job_id, raced]]);
    host._activeJobs = new Map([[raced.configuration, raced]]);
    const snapshotOnly = makeFirmwareJob({
      job_id: "j-old",
      configuration: "d.yaml",
      job_type: JobType.COMPILE,
      status: JobStatus.COMPLETED,
    });
    dispatch(host, { firmware_jobs: [snapshotOnly] });
    // The frozen snapshot predates the raced frame; both survive.
    expect(host._firmwareJobs.get("j-new")?.status).toBe(JobStatus.QUEUED);
    expect(host._firmwareJobs.has("j-old")).toBe(true);
    expect(host._activeJobs.get("c.yaml")?.job_id).toBe("j-new");
  });

  it("mirrors a live RENAME job under its soon-to-be-renamed key", () => {
    const host = makeHost();
    const rename = makeFirmwareJob({
      job_id: "j-ren",
      configuration: "old.yaml",
      job_type: JobType.RENAME,
      status: JobStatus.RUNNING,
      new_name: "brand-new",
    });
    dispatch(host, { firmware_jobs: [rename] });
    expect(host._activeJobs.get("old.yaml")?.job_id).toBe("j-ren");
    expect(host._activeJobs.get("brand-new.yaml")?.job_id).toBe("j-ren");
  });

  it("seeds the jobs snapshot in one shot, terminal jobs history-only", () => {
    const host = makeHost();
    const running = makeFirmwareJob({
      job_id: "j-run",
      configuration: "a.yaml",
      job_type: JobType.COMPILE,
      status: JobStatus.RUNNING,
    });
    const done = makeFirmwareJob({
      job_id: "j-done",
      configuration: "b.yaml",
      job_type: JobType.COMPILE,
      status: JobStatus.COMPLETED,
    });
    dispatch(host, { firmware_jobs: [running, done] });
    expect([...host._firmwareJobs.keys()].sort()).toEqual(["j-done", "j-run"]);
    expect(host._activeJobs.get("a.yaml")?.job_id).toBe("j-run");
    expect(host._activeJobs.has("b.yaml")).toBe(false);
  });
});
