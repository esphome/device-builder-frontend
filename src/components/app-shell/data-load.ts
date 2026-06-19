import { OnboardingStepId, type UserPreferences } from "../../api/types/system.js";
import {
  isExperienceChosen,
  shouldAutoShowOnboarding,
} from "../../util/onboarding-gate.js";
import { fetchSecretKeys } from "../../util/secrets-cache.js";
import type { ESPHomeApp } from "../app-shell.js";

/** Apply a preferences snapshot to the app-shell's live contexts. */
export function applyPreferences(host: ESPHomeApp, prefs: UserPreferences): void {
  host.applyTheme(prefs.theme);
  host._experienceLevel = prefs.experience_level;
  host._remoteComputeOnly = prefs.remote_compute_only;
}

export async function loadOnboardingState(host: ESPHomeApp): Promise<void> {
  try {
    const state = await host._api.getOnboardingState();
    host._onboardingHasUseCase = state.steps.some(
      (s) => s.id === OnboardingStepId.USE_CASE
    );
    // Only the full first-run wizard (use-case + experience) auto-pops now;
    // Wi-Fi is collected per-device in the create wizard, never auto-popped.
    host._onboardingShouldShow =
      shouldAutoShowOnboarding(state, host._onboardingSessionDismissed) &&
      !isExperienceChosen(state);
  } catch (err) {
    // Non-critical — leave _onboardingShouldShow alone so a transient reload on
    // a session-dismissed state can't re-open the wizard.
    console.warn("Failed to load onboarding state:", err);
  }
  // The kebab "Set up Wi-Fi" / "Change Wi-Fi" entry is always present; its
  // wording tracks whether a shared Wi-Fi secret exists yet — both a wifi_ssid
  // and a wifi_password key, matching the wizard's skip rule and the backend's
  // wifi_secrets_defined. Use the shared secret-keys cache so this rides the
  // same `secrets-saved` refresh the pickers do (it caches [] on failure).
  const keys = await fetchSecretKeys(host._api);
  host._onboardingPending = !(
    keys.includes("wifi_ssid") && keys.includes("wifi_password")
  );
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

export async function loadPreferences(host: ESPHomeApp): Promise<void> {
  // Boot/reconnect prefs come from the subscribe snapshot; this refetch exists
  // only to reflect the onboarding wizard's direct persist in the live contexts.
  // Skip while a write is in flight; the optimistic value wins until it settles.
  if (host._prefsWritesInFlight > 0) return;
  try {
    applyPreferences(host, await host._api.getPreferences());
    host._prefsLoaded = true;
  } catch (err) {
    // Non-fatal: the snapshot already seeded these, and theme also has a
    // localStorage fallback. Logged for diagnostics rather than toasted.
    console.warn("Failed to refresh preferences:", err);
  }
}
