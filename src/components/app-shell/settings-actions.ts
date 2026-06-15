import toast from "sonner-js";
import type { VersionMatchPolicy } from "../../api/types/event-subscription.js";
import type { RemoteBuildSubmitTarget } from "../../api/types/firmware-jobs.js";
import {
  CLEANUP_TTL_MAX_SECONDS,
  CLEANUP_TTL_MIN_SECONDS,
  type PairingSummary,
} from "../../api/types/remote-build.js";
import { ExperienceLevel, type Theme } from "../../api/types/system.js";
import {
  clearStoredLocale,
  loadLocalize,
  type SupportedLocale,
  writeStoredLocale,
} from "../../common/localize.js";
import type { ESPHomeApp } from "../app-shell.js";
import { patchOffloadPairing } from "./events.js";

export function onSetTheme(host: ESPHomeApp, e: CustomEvent<string>): void {
  const theme = e.detail as Theme;
  host.applyTheme(theme);
  // Count the write like the other prefs writes so a reconnect can't reload
  // and revert the optimistic theme mid-flight. Theme has a localStorage
  // fallback and self-corrects on the next successful load, so a failure is
  // logged rather than reverted + toasted.
  host._prefsWritesInFlight += 1;
  host._api
    .updatePreferences({ theme })
    .catch((err) => console.warn("Failed to save theme:", err))
    .finally(() => {
      host._prefsWritesInFlight -= 1;
    });
}

// experience_level is the single source of truth; EXPERT unlocks the power-user
// surfaces and the editor's first-open layout. Revert + toast on failure so the
// stored level can't silently diverge from the UI.
function setExperienceLevel(host: ESPHomeApp, level: ExperienceLevel): void {
  const previousLevel = host._experienceLevel;
  host._experienceLevel = level;
  // Count the write so a reconnect's INITIAL_STATE snapshot can't reload the
  // pre-write values over the optimistic ones mid-flight.
  host._prefsWritesInFlight += 1;
  host._api
    .updatePreferences({ experience_level: level })
    .catch((err) => {
      console.warn("Failed to save experience level:", err);
      host._experienceLevel = previousLevel;
      toast.error(host._localize("settings.experience_save_failed"), {
        richColors: true,
      });
    })
    .finally(() => {
      host._prefsWritesInFlight -= 1;
    });
}

export function onSetRemoteComputeOnly(host: ESPHomeApp, e: CustomEvent<boolean>): void {
  const enabled = e.detail;
  const previous = host._remoteComputeOnly;
  host._remoteComputeOnly = enabled;
  host._prefsWritesInFlight += 1;
  host._api
    .updatePreferences({ remote_compute_only: enabled })
    .catch((err) => {
      console.warn("Failed to save remote-compute-only:", err);
      host._remoteComputeOnly = previous;
      toast.error(host._localize("settings.experience_save_failed"), {
        richColors: true,
      });
    })
    .finally(() => {
      host._prefsWritesInFlight -= 1;
    });
}

// Expert Mode is just experience_level === EXPERT; the Appearance/command-palette
// toggle re-points the level (off → BEGINNER) through the same write path.
export function onSetExpertMode(host: ESPHomeApp, e: CustomEvent<boolean>): void {
  setExperienceLevel(host, e.detail ? ExperienceLevel.EXPERT : ExperienceLevel.BEGINNER);
}

// Optimistic flip with revert-on-failure for security-sensitive toggles.
// _remoteBuildSetInFlight gates loadRemoteBuildSettings so a reconnect
// racing the write can't clobber the optimistic value.
export async function onSetRemoteBuildEnabled(
  host: ESPHomeApp,
  e: CustomEvent<boolean>
): Promise<void> {
  const enabled = e.detail;
  const previous = host._remoteBuildEnabled;
  host._remoteBuildEnabled = enabled;
  host._remoteBuildSetInFlight = true;
  try {
    // Omit cleanup_ttl_seconds so this path doesn't clobber a TTL another tab set.
    await host._api.setRemoteBuildSettings({ enabled });
    // Toggling enabled tears down / re-binds the peer-link runner;
    // bump the counter so settings-dialog re-fetches identity.
    host._buildServerIdentityRotationCounter += 1;
  } catch {
    host._remoteBuildEnabled = previous;
    toast.error(host._localize("settings.remote_build_save_failed"), {
      richColors: true,
    });
  } finally {
    host._remoteBuildSetInFlight = false;
  }
}

export async function onSetRemoteBuildCleanupTtl(
  host: ESPHomeApp,
  e: CustomEvent<number>
): Promise<void> {
  const requested = e.detail;
  if (
    !Number.isFinite(requested) ||
    requested < CLEANUP_TTL_MIN_SECONDS ||
    requested > CLEANUP_TTL_MAX_SECONDS
  ) {
    toast.error(host._localize("settings.remote_build_save_failed"), {
      richColors: true,
    });
    return;
  }
  const previous = host._remoteBuildCleanupTtl;
  if (previous === requested) return;
  host._remoteBuildCleanupTtl = requested;
  host._remoteBuildSetInFlight = true;
  try {
    await host._api.setRemoteBuildSettings({
      enabled: host._remoteBuildEnabled,
      cleanup_ttl_seconds: requested,
    });
  } catch {
    host._remoteBuildCleanupTtl = previous;
    toast.error(host._localize("settings.remote_build_save_failed"), {
      richColors: true,
    });
  } finally {
    host._remoteBuildSetInFlight = false;
  }
}

export async function onSetOffloaderRemoteBuildsEnabled(
  host: ESPHomeApp,
  e: CustomEvent<boolean>
): Promise<void> {
  const enabled = e.detail;
  const previous = host._offloaderRemoteBuildsEnabled;
  host._offloaderRemoteBuildsEnabled = enabled;
  try {
    await host._api.setOffloaderRemoteBuildSettings({
      remote_builds_enabled: enabled,
    });
  } catch {
    host._offloaderRemoteBuildsEnabled = previous;
    toast.error(host._localize("settings.remote_build_save_failed"), {
      richColors: true,
    });
  }
}

export async function onSetOffloaderPairingEnabled(
  host: ESPHomeApp,
  e: CustomEvent<{ pin_sha256: string; enabled: boolean }>
): Promise<void> {
  const { pin_sha256, enabled } = e.detail;
  const previous = host._buildOffloadPairings?.get(pin_sha256)?.enabled;
  patchOffloadPairing(host, pin_sha256, { enabled });
  try {
    await host._api.setOffloaderPairingEnabled({ pin_sha256, enabled });
  } catch {
    if (previous !== undefined) {
      patchOffloadPairing(host, pin_sha256, { enabled: previous });
    }
    toast.error(host._localize("settings.remote_build_save_failed"), {
      richColors: true,
    });
  }
}

export async function onSetOffloaderVersionMatchPolicy(
  host: ESPHomeApp,
  e: CustomEvent<VersionMatchPolicy>
): Promise<void> {
  const policy = e.detail;
  const previous = host._offloaderVersionMatchPolicy;
  host._offloaderVersionMatchPolicy = policy;
  try {
    await host._api.setOffloaderRemoteBuildSettings({
      version_match_policy: policy,
    });
  } catch {
    host._offloaderVersionMatchPolicy = previous;
    toast.error(host._localize("settings.remote_build_save_failed"), {
      richColors: true,
    });
  }
}

export function onPairRequestSent(
  host: ESPHomeApp,
  e: CustomEvent<{ summary: PairingSummary }>
): void {
  // Seed locally for instant feedback; OFFLOADER_PAIRING_ADDED writes the same row.
  const summary = e.detail.summary;
  const next = new Map(host._buildOffloadPairings ?? []);
  next.set(summary.pin_sha256, summary);
  host._buildOffloadPairings = next;
}

export function onRemoteBuildJobSubmitted(
  host: ESPHomeApp,
  e: CustomEvent<{
    job_id: string;
    pin_sha256: string;
    receiver_label: string;
    configuration: string;
    target: RemoteBuildSubmitTarget;
  }>
): void {
  host.registerRemoteBuildJob(e.detail);
}

export function onRemoteBuildJobDismissed(
  host: ESPHomeApp,
  e: CustomEvent<{ job_id: string }>
): void {
  host.dismissRemoteBuildJob(e.detail.job_id);
}

export async function onSetLanguage(
  host: ESPHomeApp,
  e: CustomEvent<SupportedLocale | "system">
): Promise<void> {
  const choice = e.detail;
  if (choice === "system") {
    clearStoredLocale();
  } else {
    writeStoredLocale(choice);
  }
  try {
    host._localize = await loadLocalize(choice === "system" ? undefined : choice);
  } catch (err) {
    console.error("Failed to load locale", choice, err);
  }
}
