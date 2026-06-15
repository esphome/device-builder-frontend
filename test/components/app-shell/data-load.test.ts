import { describe, expect, it, vi } from "vitest";
import {
  ExperienceLevel,
  type OnboardingState,
  OnboardingStepId,
  OnboardingStepStatus,
  type UserPreferences,
} from "../../../src/api/types/system.js";
import type { ESPHomeApp } from "../../../src/components/app-shell.js";
import {
  loadOnboardingState,
  loadPreferences,
} from "../../../src/components/app-shell/data-load.js";

const DONE = OnboardingStepStatus.DONE;
const PENDING = OnboardingStepStatus.PENDING;

function state(
  steps: Array<{ id: OnboardingStepId; status: OnboardingStepStatus }>,
  completed_version = 0,
  current_version = 2
): OnboardingState {
  return { current_version, completed_version, steps };
}

function makeHost(state: OnboardingState) {
  return {
    _onboardingPending: false,
    _onboardingHasUseCase: false,
    _onboardingShouldShow: false,
    _onboardingShowWifi: false,
    _onboardingSessionDismissed: false,
    _api: { getOnboardingState: vi.fn(async () => state) },
  };
}

describe("loadOnboardingState routing", () => {
  it("a fresh install (experience pending) routes to the wizard, not the wifi dialog", async () => {
    const host = makeHost(
      state([
        { id: OnboardingStepId.USE_CASE, status: PENDING },
        { id: OnboardingStepId.EXPERIENCE_LEVEL, status: PENDING },
        { id: OnboardingStepId.WIFI_CREDENTIALS, status: PENDING },
      ])
    );
    await loadOnboardingState(host as unknown as ESPHomeApp);
    expect(host._onboardingShouldShow).toBe(true);
    expect(host._onboardingShowWifi).toBe(false);
  });

  it("an existing install missing wifi routes to the wifi dialog, not the wizard", async () => {
    const host = makeHost(
      state([
        { id: OnboardingStepId.EXPERIENCE_LEVEL, status: DONE },
        { id: OnboardingStepId.WIFI_CREDENTIALS, status: PENDING },
      ])
    );
    await loadOnboardingState(host as unknown as ESPHomeApp);
    expect(host._onboardingShouldShow).toBe(false);
    expect(host._onboardingShowWifi).toBe(true);
  });

  it("an existing install with wifi configured pops neither", async () => {
    const host = makeHost(
      state([
        { id: OnboardingStepId.EXPERIENCE_LEVEL, status: DONE },
        { id: OnboardingStepId.WIFI_CREDENTIALS, status: DONE },
      ])
    );
    await loadOnboardingState(host as unknown as ESPHomeApp);
    expect(host._onboardingShouldShow).toBe(false);
    expect(host._onboardingShowWifi).toBe(false);
  });

  it("respects a session dismissal even when wifi is pending", async () => {
    const host = makeHost(
      state([
        { id: OnboardingStepId.EXPERIENCE_LEVEL, status: DONE },
        { id: OnboardingStepId.WIFI_CREDENTIALS, status: PENDING },
      ])
    );
    host._onboardingSessionDismissed = true;
    await loadOnboardingState(host as unknown as ESPHomeApp);
    expect(host._onboardingShowWifi).toBe(false);
  });
});

describe("loadPreferences (post-wizard context refresh)", () => {
  const prefs: UserPreferences = {
    dashboard_view: "cards" as UserPreferences["dashboard_view"],
    theme: "dark" as UserPreferences["theme"],
    navigator_visible: true,
    table_page_size: 25,
    table_column_visibility: {},
    table_sort_column: null,
    table_sort_direction: null,
    experience_level: ExperienceLevel.EXPERT,
    remote_compute_only: true,
    onboarding_completed_version: 2,
  };

  function makePrefsHost() {
    return {
      _prefsWritesInFlight: 0,
      _experienceLevel: null as ExperienceLevel | null,
      _remoteComputeOnly: false,
      _prefsLoaded: false,
      applyTheme: vi.fn(),
      _api: { getPreferences: vi.fn(async () => prefs) },
    };
  }

  it("skips the refresh while a preference write is in flight", async () => {
    const host = makePrefsHost();
    host._prefsWritesInFlight = 1;
    await loadPreferences(host as unknown as ESPHomeApp);
    expect(host._api.getPreferences).not.toHaveBeenCalled();
    expect(host._remoteComputeOnly).toBe(false);
    expect(host._experienceLevel).toBeNull();
  });

  it("applies prefs and marks loaded when no write is in flight", async () => {
    const host = makePrefsHost();
    await loadPreferences(host as unknown as ESPHomeApp);
    expect(host._experienceLevel).toBe(ExperienceLevel.EXPERT);
    expect(host._remoteComputeOnly).toBe(true);
    expect(host._prefsLoaded).toBe(true);
  });

  it("logs and leaves state intact on a fetch failure", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const host = makePrefsHost();
      host._api.getPreferences = vi.fn(async () => {
        throw new Error("boom");
      });
      await loadPreferences(host as unknown as ESPHomeApp);
      expect(host._prefsLoaded).toBe(false);
      expect(host._remoteComputeOnly).toBe(false);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
