import { describe, expect, it, vi } from "vitest";
import {
  DeviceEventType,
  type InitialStateEventData,
} from "../../../src/api/types/event-subscription.js";
import {
  DashboardView,
  Theme,
  type UserPreferences,
} from "../../../src/api/types/system.js";
import type { ESPHomeApp } from "../../../src/components/app-shell.js";
import { handleEvent } from "../../../src/components/app-shell/events.js";

function makePrefs(overrides: Partial<UserPreferences> = {}): UserPreferences {
  return {
    dashboard_view: DashboardView.CARDS,
    theme: Theme.DARK,
    navigator_visible: true,
    expert_mode: false,
    table_page_size: 25,
    table_column_visibility: {},
    table_sort_column: null,
    table_sort_direction: null,
    onboarding_completed_version: 0,
    ...overrides,
  };
}

function makeInitial(preferences: UserPreferences): InitialStateEventData {
  return { preferences, devices: [], importable: [] };
}

describe("handleEvent INITIAL_STATE preferences", () => {
  it("applies theme from the snapshot and marks prefs loaded", () => {
    const applyTheme = vi.fn();
    const host = { applyTheme } as unknown as ESPHomeApp;

    handleEvent(
      host,
      DeviceEventType.INITIAL_STATE,
      makeInitial(makePrefs({ theme: Theme.LIGHT }))
    );

    expect(applyTheme).toHaveBeenCalledWith(Theme.LIGHT);
    expect(host._prefsLoaded).toBe(true);
  });
});
