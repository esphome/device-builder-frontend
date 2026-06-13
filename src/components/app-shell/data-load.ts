import toast from "sonner-js";
import { OnboardingStepId } from "../../api/types/system.js";
import {
  isExperienceChosen,
  isWifiSetupPending,
  shouldAutoShowOnboarding,
} from "../../util/onboarding-gate.js";
import type { ESPHomeApp } from "../app-shell.js";

export async function loadOnboardingState(host: ESPHomeApp): Promise<void> {
  try {
    const state = await host._api.getOnboardingState();
    const wifiPending = isWifiSetupPending(state);
    host._onboardingPending = wifiPending;
    host._onboardingHasUseCase = state.steps.some(
      (s) => s.id === OnboardingStepId.USE_CASE
    );
    const show = shouldAutoShowOnboarding(state, host._onboardingSessionDismissed);
    // Fresh install (experience not chosen) gets the full wizard; an existing
    // install that already has an experience but is missing Wi-Fi gets only the
    // standalone Wi-Fi dialog, so it still onboards Wi-Fi unless they decline.
    const experienceChosen = isExperienceChosen(state);
    host._onboardingShouldShow = show && !experienceChosen;
    host._onboardingShowWifi = show && experienceChosen && wifiPending;
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

const PREFS_LOAD_MAX_RETRIES = 3;
const PREFS_LOAD_RETRY_DELAY_MS = 1000;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function loadThemePreference(host: ESPHomeApp): Promise<void> {
  // Until prefs load once, _hideDeviceCreation gates creation closed for every
  // install (not just remote-compute), so the first load must actually land.
  // Retry a transient failure to recover on a healthy socket, and when a racing
  // write blocks the load wait for it to settle rather than abandoning the first
  // load until the next reconnect. Once loaded, a reconnect miss keeps the last
  // good values, so don't spin.
  for (let attempt = 0; ; attempt++) {
    if (host._prefsWritesInFlight > 0) {
      // A preference write is in flight — its optimistic value is the source of
      // truth, so don't reload over it (a reconnect mid-write would otherwise
      // revert experience / remote-compute). If prefs already loaded we're done;
      // if they never have, wait for the write to settle and retry.
      if (host._prefsLoaded || attempt >= PREFS_LOAD_MAX_RETRIES) break;
      await delay(PREFS_LOAD_RETRY_DELAY_MS);
      continue;
    }
    try {
      const prefs = await host._api.getPreferences();
      host.applyTheme(prefs.theme);
      host._yamlDiffButton = prefs.yaml_diff_button;
      host._experienceLevel = prefs.experience_level;
      host._remoteComputeOnly = prefs.remote_compute_only;
      // Prefs known: stop failing creation closed and re-arm the failure toast.
      host._prefsLoaded = true;
      host._prefsLoadErrorNotified = false;
      return;
    } catch (err) {
      // Non-fatal: the last successfully-loaded values are kept (none are
      // reset here), and theme also has a localStorage fallback. Logged per
      // attempt rather than toasted, since this runs on every reconnect.
      console.warn("Failed to load preferences:", err);
      if (host._prefsLoaded || attempt >= PREFS_LOAD_MAX_RETRIES) break;
      await delay(PREFS_LOAD_RETRY_DELAY_MS);
    }
  }
  // Terminal: prefs never loaded, so creation is gated closed for the whole
  // install. Surface it once (not per reconnect) since the UI vanished without
  // a visible cause.
  if (!host._prefsLoaded && !host._prefsLoadErrorNotified) {
    host._prefsLoadErrorNotified = true;
    toast.error(host._localize("settings.preferences_load_failed"), { richColors: true });
  }
}
