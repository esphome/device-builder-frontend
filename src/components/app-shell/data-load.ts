import {
  isOnboardingPending,
  shouldAutoShowOnboarding,
} from "../../util/onboarding-gate.js";
import type { ESPHomeApp } from "../app-shell.js";

export async function loadOnboardingState(host: ESPHomeApp): Promise<void> {
  try {
    const state = await host._api.getOnboardingState();
    host._onboardingPending = isOnboardingPending(state);
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
  try {
    const prefs = await host._api.getPreferences();
    host.applyTheme(prefs.theme);
    host._yamlDiffButton = prefs.yaml_diff_button;
  } catch {
    // Preferences not critical — keep localStorage value.
  }
}
