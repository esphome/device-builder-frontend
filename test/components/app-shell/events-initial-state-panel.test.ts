// Pins the initial_state seeds the Build server panel paints from:
// receiver settings scalars (no disabled-CTA flash) and the one-shot
// firmware-jobs snapshot (no per-frame queue accretion).

import { describe, expect, it } from "vitest";
import {
  DeviceEventType,
  type InitialStateEventData,
} from "../../../src/api/types/event-subscription.js";
import { JobStatus, JobType } from "../../../src/api/types/firmware-jobs.js";
import type { ESPHomeApp } from "../../../src/components/app-shell.js";
import { handleEvent } from "../../../src/components/app-shell/events.js";
import { makeFirmwareJob } from "../../_make-firmware-job.js";

type Host = { [key: string]: unknown } & Pick<
  ESPHomeApp,
  "_remoteBuildEnabled" | "_remoteBuildCleanupTtl" | "_firmwareJobs" | "_activeJobs"
>;

function makeHost(): Host {
  return {
    _remoteBuildEnabled: false,
    _remoteBuildCleanupTtl: null,
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
    (host as Record<string, unknown>)._remoteBuildSetInFlight = true;
    dispatch(host, {
      remote_build_settings: { enabled: false, cleanup_ttl_seconds: 3600 },
    });
    expect(host._remoteBuildEnabled).toBe(true);
  });

  it("leaves the defaults alone when the field is absent (old backend)", () => {
    const host = makeHost();
    dispatch(host, {});
    expect(host._remoteBuildEnabled).toBe(false);
    expect(host._remoteBuildCleanupTtl).toBeNull();
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
