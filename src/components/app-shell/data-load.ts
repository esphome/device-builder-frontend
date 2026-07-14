import type { UserPreferences } from "../../api/types/system.js";
import {
  isExperienceChosen,
  shouldAutoShowOnboarding,
} from "../../util/onboarding-gate.js";
import { fetchSecretKeys, hasSharedWifiSecret } from "../../util/secrets-cache.js";
import type { ESPHomeApp } from "../app-shell.js";

/** Apply a preferences snapshot to the app-shell's live contexts. */
export function applyPreferences(host: ESPHomeApp, prefs: UserPreferences): void {
  host.applyTheme(prefs.theme);
  host._experienceLevel = prefs.experience_level;
  host._remoteComputeOnly = prefs.remote_compute_only;
  host._versionHistoryEnabled = prefs.version_history_enabled;
}

export async function loadOnboardingState(host: ESPHomeApp): Promise<void> {
  // The kebab "Set up Wi-Fi" / "Change Wi-Fi" wording tracks whether a shared
  // Wi-Fi secret exists. Independent of the onboarding state, so kick it off
  // first and let it overlap that fetch (cached; rides the `secrets-saved`
  // refresh the pickers do).
  const keysPromise = fetchSecretKeys(host._api);
  try {
    const state = await host._api.getOnboardingState();
    // Only the mandatory setup wizard auto-pops. Wi-Fi is collected when the
    // first Wi-Fi device needs it, never during onboarding.
    host._onboardingShouldShow =
      shouldAutoShowOnboarding(state) && !isExperienceChosen(state);
  } catch (err) {
    // Non-critical — leave the current visibility decision alone.
    console.warn("Failed to load onboarding state:", err);
  }
  host._onboardingPending = !hasSharedWifiSecret(await keysPromise);
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
