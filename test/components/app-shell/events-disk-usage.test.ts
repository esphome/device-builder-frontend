import { describe, expect, it, vi } from "vitest";

import {
  DeviceEventType,
  type InitialStateEventData,
} from "../../../src/api/types/event-subscription.js";
import type { DiskUsage, UserPreferences } from "../../../src/api/types/system.js";
import type { ESPHomeApp } from "../../../src/components/app-shell.js";
import { handleEvent } from "../../../src/components/app-shell/events.js";

const USAGE: DiskUsage = {
  total_bytes: 100,
  free_bytes: 40,
  builds_bytes: 10,
  remote_builds_bytes: 0,
  toolchains_bytes: 30,
  cache_bytes: 5,
  config_bytes: 1,
  measured_at: 1,
};

function makeHost(diskUsage: DiskUsage | null = null) {
  return {
    _diskUsage: diskUsage,
    _diskUsageFailed: false,
    // Other fields the INITIAL_STATE handler writes.
    _prefsLoaded: false,
    _prefsWritesInFlight: 1, // skip applyPreferences
    applyTheme: vi.fn(),
    _devices: [],
    _importableDevices: [],
    _devicesLoaded: false,
    _buildServerPeers: null,
    _buildOffloadDiscoveredHosts: null,
    _buildOffloadPairings: null,
    _buildOffloadAlerts: null,
    _offloaderWritesInFlight: 0,
  };
}

function initialState(
  disk_usage?: DiskUsage,
  extra: Partial<InitialStateEventData> = {}
): InitialStateEventData {
  return {
    preferences: {} as UserPreferences,
    devices: [],
    importable: [],
    ...(disk_usage ? { disk_usage } : {}),
    ...extra,
  };
}

function dispatch(host: ReturnType<typeof makeHost>, event: string, data: unknown): void {
  handleEvent(host as unknown as ESPHomeApp, event, data);
}

describe("disk usage events", () => {
  it("seeds from initial_state", () => {
    const host = makeHost();
    dispatch(host, DeviceEventType.INITIAL_STATE, initialState(USAGE));
    expect(host._diskUsage).toEqual(USAGE);
  });

  it("clears a stale value when the snapshot has none yet (backend just restarted)", () => {
    const host = makeHost(USAGE);
    dispatch(host, DeviceEventType.INITIAL_STATE, initialState());
    expect(host._diskUsage).toBeNull();
  });

  it("replaces the value on disk_usage_updated", () => {
    const host = makeHost(USAGE);
    const next = { ...USAGE, free_bytes: 39 };
    dispatch(host, DeviceEventType.DISK_USAGE_UPDATED, { disk_usage: next });
    expect(host._diskUsage).toEqual(next);
  });

  it("seeds the failed flag from initial_state and clears it on the next snapshot", () => {
    const host = makeHost();
    dispatch(
      host,
      DeviceEventType.INITIAL_STATE,
      initialState(undefined, { disk_usage_failed: true })
    );
    expect(host._diskUsageFailed).toBe(true);
    dispatch(host, DeviceEventType.INITIAL_STATE, initialState(USAGE));
    expect(host._diskUsageFailed).toBe(false);
  });

  it("flags a failed measurement until one succeeds", () => {
    const host = makeHost();
    dispatch(host, DeviceEventType.DISK_USAGE_FAILED, {});
    expect(host._diskUsageFailed).toBe(true);
    expect(host._diskUsage).toBeNull();
    dispatch(host, DeviceEventType.DISK_USAGE_UPDATED, { disk_usage: USAGE });
    expect(host._diskUsageFailed).toBe(false);
    expect(host._diskUsage).toEqual(USAGE);
  });
});
