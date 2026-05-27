import toast from "sonner-js";
import {
  CLEANUP_TTL_MAX_SECONDS,
  CLEANUP_TTL_MIN_SECONDS,
  type PairingSummary,
  type RemoteBuildSubmitTarget,
  type Theme,
} from "../../api/types.js";
import {
  clearStoredLocale,
  loadLocalize,
  type SupportedLocale,
  writeStoredLocale,
} from "../../common/localize.js";
import { patchOffloadPairing } from "./events.js";
import type { ESPHomeApp } from "../app-shell.js";

export function onSetTheme(host: ESPHomeApp, e: CustomEvent<string>): void {
  const theme = e.detail as Theme;
  host.applyTheme(theme);
  host._api.updatePreferences({ theme }).catch(() => {});
}

export function onSetYamlDiffButton(host: ESPHomeApp, e: CustomEvent<boolean>): void {
  const enabled = e.detail;
  host._yamlDiffButton = enabled;
  host._api.updatePreferences({ yaml_diff_button: enabled }).catch(() => {});
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

export function onPairRequestSent(
  host: ESPHomeApp,
  e: CustomEvent<{ summary: PairingSummary }>
): void {
  // Backend persists the row but doesn't fire OFFLOADER_PAIR_STATUS_CHANGED
  // for create (events only mark status flips), so seed the row locally.
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
