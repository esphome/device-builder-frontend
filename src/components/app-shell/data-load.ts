import type { UserPreferences } from "../../api/types/system.js";
import type { DashboardPrefs, DashboardPrefsChange } from "../../context/index.js";
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
  host._hideDeviceBuilder = prefs.hide_device_builder;
  host._versionHistoryEnabled = prefs.version_history_enabled;
}

/** The dashboard's view and table slice of *prefs*. */
export function pickDashboardPrefs(prefs: UserPreferences): DashboardPrefs {
  return {
    dashboard_view: prefs.dashboard_view,
    table_page_size: prefs.table_page_size,
    table_column_visibility: prefs.table_column_visibility,
    table_sort_column: prefs.table_sort_column,
    table_sort_direction: prefs.table_sort_direction,
  };
}

/** Track a dashboard write and merge its values, keeping pending patches on top. */
export function onDashboardPrefsChanged(
  host: ESPHomeApp,
  e: CustomEvent<DashboardPrefsChange>
): void {
  const { prefs, phase } = e.detail;
  if (phase === "start") {
    host._dashboardWroteSinceSnapshot = true;
    host._dashboardWritesInFlight += 1;
    host._pendingDashboardPrefs = { ...host._pendingDashboardPrefs, ...prefs };
  } else {
    host._dashboardWritesInFlight = Math.max(0, host._dashboardWritesInFlight - 1);
    if (host._dashboardWritesInFlight === 0) host._pendingDashboardPrefs = {};
  }
  if (host._dashboardPrefs) {
    host._dashboardPrefs = {
      ...host._dashboardPrefs,
      ...prefs,
      ...host._pendingDashboardPrefs,
    };
  }
}

/**
 * Reseed the shell's dashboard prefs from a snapshot, keeping pending patches on top.
 *
 * A snapshot can predate a dashboard write whose reply already arrived, so after
 * any write since the last snapshot the slice is refetched; the server answers
 * in order, after that write.
 */
export function applyDashboardSnapshot(host: ESPHomeApp, prefs: UserPreferences): void {
  host._dashboardPrefs = { ...pickDashboardPrefs(prefs), ...host._pendingDashboardPrefs };
  if (!host._dashboardWroteSinceSnapshot) return;
  host._dashboardWroteSinceSnapshot = false;
  void refreshDashboardPrefs(host);
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

async function refreshDashboardPrefs(host: ESPHomeApp): Promise<void> {
  const current = await host._api.getPreferences().catch(() => null);
  if (current) {
    host._dashboardPrefs = {
      ...pickDashboardPrefs(current),
      ...host._pendingDashboardPrefs,
    };
  }
}
