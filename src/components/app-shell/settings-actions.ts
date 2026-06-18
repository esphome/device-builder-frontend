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

interface OptimisticSetting<T> {
  get: () => T;
  set: (value: T) => void;
  write: () => Promise<unknown>;
  value: T;
  toastKey?: string;
  inFlight?: (active: boolean) => void;
  warn?: string;
  onSuccess?: () => void;
}

// Capture previous, optimistic set, await write, revert + toast on failure.
// ``set`` and ``inFlight`` run before the first await, so the optimistic value
// and the in-flight guard take effect synchronously for the caller.
async function optimisticSetting<T>(
  host: ESPHomeApp,
  { get, set, write, value, toastKey, inFlight, warn, onSuccess }: OptimisticSetting<T>
): Promise<void> {
  const previous = get();
  set(value);
  inFlight?.(true);
  try {
    await write();
    onSuccess?.();
  } catch (err) {
    set(previous);
    if (warn) console.warn(warn, err);
    if (toastKey) {
      toast.error(host._localize(toastKey), { richColors: true });
    }
  } finally {
    inFlight?.(false);
  }
}

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
// stored level can't silently diverge from the UI. The in-flight count stops a
// reconnect's INITIAL_STATE snapshot reloading the pre-write value mid-flight.
function setExperienceLevel(host: ESPHomeApp, level: ExperienceLevel): void {
  void optimisticSetting(host, {
    get: () => host._experienceLevel,
    set: (v) => {
      host._experienceLevel = v;
    },
    write: () => host._api.updatePreferences({ experience_level: level }),
    value: level,
    toastKey: "settings.experience_save_failed",
    warn: "Failed to save experience level:",
    inFlight: (active) => {
      host._prefsWritesInFlight += active ? 1 : -1;
    },
  });
}

export function onSetRemoteComputeOnly(host: ESPHomeApp, e: CustomEvent<boolean>): void {
  void optimisticSetting(host, {
    get: () => host._remoteComputeOnly,
    set: (v) => {
      host._remoteComputeOnly = v;
    },
    write: () => host._api.updatePreferences({ remote_compute_only: e.detail }),
    value: e.detail,
    toastKey: "settings.experience_save_failed",
    warn: "Failed to save remote-compute-only:",
    inFlight: (active) => {
      host._prefsWritesInFlight += active ? 1 : -1;
    },
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
export function onSetRemoteBuildEnabled(
  host: ESPHomeApp,
  e: CustomEvent<boolean>
): Promise<void> {
  return optimisticSetting(host, {
    get: () => host._remoteBuildEnabled,
    set: (v) => {
      host._remoteBuildEnabled = v;
    },
    // Omit cleanup_ttl_seconds so this path doesn't clobber a TTL another tab set.
    write: () => host._api.setRemoteBuildSettings({ enabled: e.detail }),
    value: e.detail,
    toastKey: "settings.remote_build_save_failed",
    inFlight: (active) => {
      host._remoteBuildSetInFlight = active;
    },
    // Toggling enabled tears down / re-binds the peer-link runner;
    // bump the counter so settings-dialog re-fetches identity.
    onSuccess: () => {
      host._buildServerIdentityRotationCounter += 1;
    },
  });
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

export function onSetOffloaderRemoteBuildsEnabled(
  host: ESPHomeApp,
  e: CustomEvent<boolean>
): Promise<void> {
  return optimisticSetting(host, {
    get: () => host._offloaderRemoteBuildsEnabled,
    set: (v) => {
      host._offloaderRemoteBuildsEnabled = v;
    },
    write: () =>
      host._api.setOffloaderRemoteBuildSettings({ remote_builds_enabled: e.detail }),
    value: e.detail,
    toastKey: "settings.remote_build_save_failed",
    inFlight: (active) => {
      host._offloaderWritesInFlight += active ? 1 : -1;
    },
  });
}

export function onSetOffloaderIncludeLocal(
  host: ESPHomeApp,
  e: CustomEvent<boolean>
): Promise<void> {
  return optimisticSetting(host, {
    get: () => host._offloaderIncludeLocalInPool,
    set: (v) => {
      host._offloaderIncludeLocalInPool = v;
    },
    write: () =>
      host._api.setOffloaderRemoteBuildSettings({ include_local_in_pool: e.detail }),
    value: e.detail,
    toastKey: "settings.remote_build_save_failed",
    inFlight: (active) => {
      host._offloaderWritesInFlight += active ? 1 : -1;
    },
  });
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

export function onSetOffloaderVersionMatchPolicy(
  host: ESPHomeApp,
  e: CustomEvent<VersionMatchPolicy>
): Promise<void> {
  return optimisticSetting(host, {
    get: () => host._offloaderVersionMatchPolicy,
    set: (v) => {
      host._offloaderVersionMatchPolicy = v;
    },
    write: () =>
      host._api.setOffloaderRemoteBuildSettings({ version_match_policy: e.detail }),
    value: e.detail,
    toastKey: "settings.remote_build_save_failed",
    inFlight: (active) => {
      host._offloaderWritesInFlight += active ? 1 : -1;
    },
  });
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
