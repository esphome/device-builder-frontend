import { OnboardingStepId } from "../../api/types/system.js";
import {
  isWifiSetupPending,
  shouldAutoShowOnboarding,
} from "../../util/onboarding-gate.js";
import type { ESPHomeApp } from "../app-shell.js";

export async function loadOnboardingState(host: ESPHomeApp): Promise<void> {
  try {
    const state = await host._api.getOnboardingState();
    host._onboardingPending = isWifiSetupPending(state);
    host._onboardingHasUseCase = state.steps.some(
      (s) => s.id === OnboardingStepId.USE_CASE
    );
    host._onboardingShouldShow = shouldAutoShowOnboarding(
      state,
      host._onboardingSessionDismissed
    );
  } catch (err) {
    // Non-critical — clear the badge (latest data unknown, "no nudge" is safer
    // than a stale red dot) but leave _onboardingShouldShow alone so a
    // transient reload on a session-dismissed state can't re-open the wizard.
    console.warn("Failed to load onboarding state:", err);
    host._onboardingPending = false;
  }
}

export async function loadRemoteBuildSettings(host: ESPHomeApp): Promise<void> {
  // Skip if a user-initiated write is in flight — the optimistic value is the
  // source of truth until the write completes.
  if (host._remoteBuildSetInFlight) return;
  try {
    const settings = await host._api.getRemoteBuildSettings();
    host._remoteBuildEnabled = settings.enabled;
    host._remoteBuildCleanupTtl = settings.cleanup_ttl_seconds;
  } catch (err) {
    console.warn("Could not load remote-build settings:", err);
  }
}

export async function loadLabels(host: ESPHomeApp): Promise<void> {
  try {
    host._labels = await host._api.listLabels();
  } catch (err) {
    console.warn("Failed to load labels catalog:", err);
  }
}

export async function loadIntegrationDocs(host: ESPHomeApp): Promise<void> {
  try {
    host._integrationDocs = await host._api.getIntegrationDocs();
  } catch (err) {
    console.warn("Failed to load integration docs URLs:", err);
  }
}

export async function loadThemePreference(host: ESPHomeApp): Promise<void> {
  // Skip while a preference write is in flight — the optimistic value is the
  // source of truth until it completes (a reconnect mid-write would otherwise
  // reload the pre-write snapshot and revert experience / remote-compute).
  if (host._prefsSetInFlight) return;
  try {
    const prefs = await host._api.getPreferences();
    host.applyTheme(prefs.theme);
    host._yamlDiffButton = prefs.yaml_diff_button;
    host._experienceLevel = prefs.experience_level;
    host._remoteComputeOnly = prefs.remote_compute_only;
  } catch (err) {
    // Theme falls back to the localStorage value, but experience and
    // remote-compute have no local backing, so surface the failure rather
    // than silently leaving device creation visible on an install that
    // wanted it hidden.
    console.warn("Failed to load preferences:", err);
  }
}
