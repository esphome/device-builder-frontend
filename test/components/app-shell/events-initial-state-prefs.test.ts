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
  };
}

function snapshot(preferences: UserPreferences): InitialStateEventData {
  return { preferences, devices: [], importable: [] };
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
