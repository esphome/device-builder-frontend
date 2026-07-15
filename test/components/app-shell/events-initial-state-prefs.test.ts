import { describe, expect, it, vi } from "vitest";
import {
  DeviceEventType,
  type InitialStateEventData,
} from "../../../src/api/types/event-subscription.js";
import {
  EditorLayout,
  ExperienceLevel,
  SecretsEditorLayout,
  type UserPreferences,
} from "../../../src/api/types/system.js";
import type { ESPHomeApp } from "../../../src/components/app-shell.js";
import { handleEvent } from "../../../src/components/app-shell/events.js";

function prefs(over: Partial<UserPreferences> = {}): UserPreferences {
  return {
    dashboard_view: "cards" as UserPreferences["dashboard_view"],
    theme: "dark" as UserPreferences["theme"],
    navigator_visible: true,
    device_editor_layout: EditorLayout.BOTH,
    secrets_editor_layout: SecretsEditorLayout.VISUAL,
    table_page_size: 25,
    table_column_visibility: {},
    table_sort_column: null,
    table_sort_direction: null,
    experience_level: ExperienceLevel.EXPERT,
    remote_compute_only: true,
    hide_device_builder: false,
    version_history_enabled: true,
    onboarding_completed_version: 2,
    ...over,
  };
}

function makeHost() {
  return {
    _prefsLoaded: false,
    _prefsWritesInFlight: 0,
    _experienceLevel: null as ExperienceLevel | null,
    _remoteComputeOnly: false,
    applyTheme: vi.fn(),
    // Other fields the INITIAL_STATE handler also writes.
    _devices: [],
    _importableDevices: [],
    _devicesLoaded: false,
    _buildServerPeers: null,
    _buildOffloadDiscoveredHosts: null,
    _buildOffloadPairings: null,
    _buildOffloadAlerts: null,
    // Offloader settings, gated by _offloaderWritesInFlight.
    _offloaderWritesInFlight: 0,
    _offloaderRemoteBuildsEnabled: null as boolean | null,
    _offloaderVersionMatchPolicy: null,
    _offloaderIncludeLocalInPool: null as boolean | null,
  };
}

function snapshot(
  preferences: UserPreferences,
  offloader: Partial<
    Pick<
      InitialStateEventData,
      "remote_builds_enabled" | "version_match_policy" | "include_local_in_pool"
    >
  > = {}
): InitialStateEventData {
  return { preferences, devices: [], importable: [], ...offloader };
}

function dispatch(host: ReturnType<typeof makeHost>, data: InitialStateEventData): void {
  handleEvent(host as unknown as ESPHomeApp, DeviceEventType.INITIAL_STATE, data);
}

describe("handleEvent INITIAL_STATE preferences", () => {
  it("applies prefs from the snapshot and marks them loaded", () => {
    const host = makeHost();
    dispatch(host, snapshot(prefs()));
    expect(host._prefsLoaded).toBe(true);
    expect(host._experienceLevel).toBe(ExperienceLevel.EXPERT);
    expect(host._remoteComputeOnly).toBe(true);
    expect(host.applyTheme).toHaveBeenCalledWith("dark");
  });

  it("does not throw or drop the rest of the snapshot when preferences is absent", () => {
    const host = makeHost();
    // A faulted snapshot with no `preferences` must still apply the rest.
    const data = {
      devices: [],
      importable: [],
    } as unknown as InitialStateEventData;
    expect(() => dispatch(host, data)).not.toThrow();
    expect(host._prefsLoaded).toBe(true);
    expect(host.applyTheme).not.toHaveBeenCalled();
    expect(host._devicesLoaded).toBe(true);
  });

  it("marks loaded but keeps optimistic values while a write is in flight", () => {
    const host = makeHost();
    host._prefsWritesInFlight = 1;
    host._remoteComputeOnly = false; // optimistic local value
    host._experienceLevel = ExperienceLevel.BEGINNER;
    dispatch(host, snapshot(prefs()));
    // A reconnect snapshot must not revert the in-flight write.
    expect(host._prefsLoaded).toBe(true);
    expect(host._remoteComputeOnly).toBe(false);
    expect(host._experienceLevel).toBe(ExperienceLevel.BEGINNER);
    expect(host.applyTheme).not.toHaveBeenCalled();
  });
});

describe("handleEvent INITIAL_STATE offloader settings", () => {
  it("applies offloader settings from the snapshot when no write is in flight", () => {
    const host = makeHost();
    dispatch(
      host,
      snapshot(prefs(), { remote_builds_enabled: false, include_local_in_pool: true })
    );
    expect(host._offloaderRemoteBuildsEnabled).toBe(false);
    expect(host._offloaderIncludeLocalInPool).toBe(true);
  });

  it("keeps optimistic offloader values while a write is in flight", () => {
    const host = makeHost();
    host._offloaderWritesInFlight = 1;
    host._offloaderRemoteBuildsEnabled = true; // optimistic local value
    host._offloaderIncludeLocalInPool = true;
    dispatch(
      host,
      snapshot(prefs(), { remote_builds_enabled: false, include_local_in_pool: false })
    );
    // A reconnect snapshot must not revert the in-flight write.
    expect(host._offloaderRemoteBuildsEnabled).toBe(true);
    expect(host._offloaderIncludeLocalInPool).toBe(true);
  });
});
