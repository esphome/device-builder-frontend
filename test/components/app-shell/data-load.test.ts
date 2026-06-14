import { beforeEach, describe, expect, it, vi } from "vitest";
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
  loadThemePreference,
} from "../../../src/components/app-shell/data-load.js";

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock("sonner-js", () => ({
  default: { error: (...args: unknown[]) => toastError(...args) },
}));

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

describe("loadThemePreference in-flight gate", () => {
  const prefs: UserPreferences = {
    dashboard_view: "cards" as UserPreferences["dashboard_view"],
    theme: "dark" as UserPreferences["theme"],
    navigator_visible: true,
    yaml_diff_button: true,
    table_page_size: 25,
    table_column_visibility: {},
    table_sort_column: null,
    table_sort_direction: null,
    experience_level: ExperienceLevel.YAML,
    remote_compute_only: true,
    onboarding_completed_version: 2,
  };

  function makePrefsHost() {
    return {
      _prefsWritesInFlight: 0,
      _yamlDiffButton: false,
      _experienceLevel: null as ExperienceLevel | null,
      _remoteComputeOnly: false,
      _prefsLoaded: false,
      _prefsLoadErrorNotified: false,
      _localize: ((key: string) => key) as ESPHomeApp["_localize"],
      applyTheme: vi.fn(),
      _api: { getPreferences: vi.fn(async () => prefs) },
    };
  }

  beforeEach(() => toastError.mockClear());

  it("does not reload over an in-flight write once prefs have loaded", async () => {
    const host = makePrefsHost();
    host._prefsLoaded = true;
    host._prefsWritesInFlight = 1;
    await loadThemePreference(host as unknown as ESPHomeApp);
    expect(host._api.getPreferences).not.toHaveBeenCalled();
    expect(host._remoteComputeOnly).toBe(false);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("waits for an in-flight write then completes the first load", async () => {
    vi.useFakeTimers();
    try {
      const host = makePrefsHost();
      host._prefsWritesInFlight = 1;
      const pending = loadThemePreference(host as unknown as ESPHomeApp);
      // First iteration defers without reading over the optimistic write.
      await vi.advanceTimersByTimeAsync(0);
      expect(host._api.getPreferences).not.toHaveBeenCalled();
      // Write settles; the next retry tick performs the first load.
      host._prefsWritesInFlight = 0;
      await vi.advanceTimersByTimeAsync(1000);
      await pending;
      expect(host._prefsLoaded).toBe(true);
      expect(host._remoteComputeOnly).toBe(true);
      expect(toastError).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("loads experience and remote-compute when no write is in flight", async () => {
    const host = makePrefsHost();
    await loadThemePreference(host as unknown as ESPHomeApp);
    expect(host._experienceLevel).toBe(ExperienceLevel.YAML);
    expect(host._remoteComputeOnly).toBe(true);
    expect(host._yamlDiffButton).toBe(true);
  });

  it("marks prefs loaded on success so creation stops failing closed", async () => {
    const host = makePrefsHost();
    await loadThemePreference(host as unknown as ESPHomeApp);
    expect(host._prefsLoaded).toBe(true);
  });

  it("leaves prefs unloaded after exhausting retries when the fetch keeps failing", async () => {
    vi.useFakeTimers();
    try {
      const host = makePrefsHost();
      host._api.getPreferences = vi.fn(async () => {
        throw new Error("boom");
      });
      const pending = loadThemePreference(host as unknown as ESPHomeApp);
      await vi.runAllTimersAsync();
      await pending;
      expect(host._prefsLoaded).toBe(false);
      // Initial attempt plus three retries.
      expect(host._api.getPreferences).toHaveBeenCalledTimes(4);
      // Terminal first-load failure surfaces once instead of hiding silently.
      expect(toastError).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("defers the load-failure toast while a write stays in flight, then surfaces it", async () => {
    vi.useFakeTimers();
    try {
      const host = makePrefsHost();
      host._prefsWritesInFlight = 1; // hung write: never settles
      const pending = loadThemePreference(host as unknown as ESPHomeApp);
      // Through the retry budget the toast stays quiet (a write isn't a load
      // failure) and the load never reads over the optimistic write.
      await vi.advanceTimersByTimeAsync(1000 * 3 + 100);
      await pending;
      expect(host._prefsLoaded).toBe(false);
      expect(host._api.getPreferences).not.toHaveBeenCalled();
      expect(toastError).not.toHaveBeenCalled();
      // After the bounded hung-write fallback elapses, the gated UI is surfaced.
      await vi.advanceTimersByTimeAsync(10_000);
      expect(toastError).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries a transient first-load failure and loads once it succeeds", async () => {
    vi.useFakeTimers();
    try {
      const host = makePrefsHost();
      let calls = 0;
      host._api.getPreferences = vi.fn(async () => {
        calls += 1;
        if (calls === 1) throw new Error("transient");
        return prefs;
      });
      const pending = loadThemePreference(host as unknown as ESPHomeApp);
      await vi.runAllTimersAsync();
      await pending;
      expect(host._prefsLoaded).toBe(true);
      expect(host._remoteComputeOnly).toBe(true);
      expect(toastError).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
