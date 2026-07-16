import { DeviceState } from "../../api/types/devices.js";
import type {
  DeviceEventData,
  DeviceStateChangedEventData,
  ImportableDeviceAddedEventData,
  ImportableDeviceRemovedEventData,
  InitialStateEventData,
  LabelDeletedEventData,
  LabelEventData,
} from "../../api/types/event-subscription.js";
import { DeviceEventType } from "../../api/types/event-subscription.js";
import type {
  OffloaderIncludeLocalChangedEventData,
  OffloaderJobOutputEventData,
  OffloaderJobStateChangedEventData,
  OffloaderPairAlertDismissedEventData,
  OffloaderPairingAddedEventData,
  OffloaderPairingEnabledChangedEventData,
  OffloaderPairPeerRevokedEventData,
  OffloaderPairPinMismatchEventData,
  OffloaderPairStatusChangedEventData,
  OffloaderPeerLinkClosedEventData,
  OffloaderPeerLinkOpenedEventData,
  OffloaderRemoteBuildsToggledEventData,
  OffloaderVersionMatchPolicyChangedEventData,
  ReceiverPeerLinkSessionEventData,
  ReceiverPeerLinkSessionOpenedEventData,
  RemoteBuildHostAddedEventData,
  RemoteBuildHostRemovedEventData,
  RemoteBuildPairingWindowChangedEventData,
  RemoteBuildPairRequestReceivedEventData,
  RemoteBuildPairStatusChangedEventData,
} from "../../api/types/remote-build-events.js";
import type { PairingSummary, PeerSummary } from "../../api/types/remote-build.js";
import {
  type RemoteBuildJobState,
  stubRemoteBuildJobState,
} from "../../context/index.js";
import { seededMap } from "../../util/snapshot.js";
import type { ESPHomeApp } from "../app-shell.js";
import { applyPreferences } from "./data-load.js";
import { seedJobs } from "./jobs.js";

// Merge a partial diff into the matching offloader pairing row keyed by pin_sha256.
// _buildOffloadPairings === null = snapshot not seeded; missing row = event raced
// the snapshot. Both no-op: the next initial_state reseed carries the right state.
export function patchOffloadPairing(
  host: ESPHomeApp,
  pin: string,
  diff: Partial<PairingSummary>
): void {
  if (host._buildOffloadPairings === null) return;
  const existing = host._buildOffloadPairings.get(pin);
  if (existing === undefined) return;
  const next = new Map(host._buildOffloadPairings);
  next.set(pin, { ...existing, ...diff });
  host._buildOffloadPairings = next;
}

export function handleEvent(host: ESPHomeApp, event: string, data: unknown): void {
  switch (event) {
    case DeviceEventType.INITIAL_STATE: {
      const {
        preferences,
        devices,
        importable,
        peers,
        hosts,
        pairings,
        offloader_alerts,
        remote_jobs,
        remote_build_settings,
        firmware_jobs,
        remote_builds_enabled,
        version_match_policy,
        include_local_in_pool,
      } = data as InitialStateEventData;
      // Mark prefs known so creation gates on the subscription, not a separate
      // get_preferences (preferences is always present). Skip the apply while a
      // Settings write is in flight, so a reconnect's snapshot can't revert the
      // optimistic change.
      host._prefsLoaded = true;
      if (preferences && host._prefsWritesInFlight === 0) {
        applyPreferences(host, preferences);
      }
      host._devices = devices;
      host._importableDevices = importable;
      host._devicesLoaded = true;
      host._buildServerPeers = peers ?? null;
      host._buildOffloadDiscoveredHosts = seededMap(hosts, (h) => h.name);
      // Skip re-seeding pairings while an offloader write is in flight, so a
      // reconnect snapshot can't revert the optimistic `enabled` of a
      // security-sensitive pairing toggle mid-write. Incremental
      // ADDED/REMOVED/CHANGED events keep the map live in the meantime. Always
      // seed on the first snapshot (null = not yet seeded) so the UI can paint.
      if (host._buildOffloadPairings === null || host._offloaderWritesInFlight === 0) {
        host._buildOffloadPairings = seededMap(pairings, (p) => p.pin_sha256);
      }
      host._buildOffloadAlerts = seededMap(offloader_alerts, (a) => a.pin_sha256);
      // remote_jobs: backend snapshot is authoritative for which jobs exist,
      // but merge onto local entries so a reconnect doesn't wipe display fields
      // (configuration / target / receiver_label) that submit_job seeded.
      if (remote_jobs !== undefined) {
        const seeded = new Map<string, RemoteBuildJobState>();
        for (const entry of remote_jobs) {
          const existing = host._buildOffloadJobs.get(entry.job_id);
          const base =
            existing ?? stubRemoteBuildJobState(entry.job_id, entry.pin_sha256);
          seeded.set(entry.job_id, {
            ...base,
            pin_sha256: entry.pin_sha256,
            status: entry.status,
            error_message: entry.error_message,
          });
        }
        host._buildOffloadJobs = seeded;
      }
      // Receiver settings scalars: same skip-while-write guard the
      // loadRemoteBuildSettings refresh uses, so a reconnect snapshot
      // can't revert an optimistic toggle mid-write.
      if (remote_build_settings !== undefined && !host._remoteBuildSetInFlight) {
        host._remoteBuildEnabled = remote_build_settings.enabled;
        host._remoteBuildCleanupTtl = remote_build_settings.cleanup_ttl_seconds;
      }
      if (firmware_jobs !== undefined) seedJobs(host, firmware_jobs);
      // Skip re-applying offloader settings while a toggle write is in flight,
      // so a reconnect's snapshot can't revert the optimistic value mid-write.
      if (host._offloaderWritesInFlight === 0) {
        if (remote_builds_enabled !== undefined) {
          host._offloaderRemoteBuildsEnabled = remote_builds_enabled;
        }
        if (version_match_policy !== undefined) {
          host._offloaderVersionMatchPolicy = version_match_policy;
        }
        if (include_local_in_pool !== undefined) {
          host._offloaderIncludeLocalInPool = include_local_in_pool;
        }
      }
      break;
    }
    case DeviceEventType.DEVICE_ADDED: {
      const { device } = data as DeviceEventData;
      if (!host._devices.some((d) => d.configuration === device.configuration)) {
        host._devices = [...host._devices, device];
      }
      break;
    }
    case DeviceEventType.DEVICE_UPDATED: {
      const { device } = data as DeviceEventData;
      host._devices = host._devices.map((d) =>
        d.configuration === device.configuration ? device : d
      );
      break;
    }
    case DeviceEventType.DEVICE_REMOVED: {
      const { device } = data as DeviceEventData;
      host._devices = host._devices.filter(
        (d) => d.configuration !== device.configuration
      );
      break;
    }
    case DeviceEventType.DEVICE_STATE_CHANGED: {
      // Narrow event stays flat on the wire; fold it into runtime_state.
      // New runtime_state object so Lit change detection sees the update.
      const { configuration, state } = data as DeviceStateChangedEventData;
      host._devices = host._devices.map((d) =>
        d.configuration === configuration
          ? { ...d, runtime_state: { ...d.runtime_state, state: state as DeviceState } }
          : d
      );
      break;
    }
    case DeviceEventType.IMPORTABLE_DEVICE_ADDED: {
      // Upsert by name so an ignore-toggle re-fire updates the ignored flag in place.
      const { device } = data as ImportableDeviceAddedEventData;
      const idx = host._importableDevices.findIndex((d) => d.name === device.name);
      if (idx === -1) {
        host._importableDevices = [...host._importableDevices, device];
      } else {
        const next = [...host._importableDevices];
        next[idx] = device;
        host._importableDevices = next;
      }
      break;
    }
    case DeviceEventType.IMPORTABLE_DEVICE_REMOVED: {
      const { name } = data as ImportableDeviceRemovedEventData;
      host._importableDevices = host._importableDevices.filter((d) => d.name !== name);
      break;
    }
    case DeviceEventType.LABEL_CREATED: {
      const { label } = data as LabelEventData;
      if (!host._labels.some((l) => l.id === label.id)) {
        host._labels = [...host._labels, label];
      }
      break;
    }
    case DeviceEventType.LABEL_UPDATED: {
      // Upsert, not replace — missing entries (failed initial fetch / dropped event)
      // would silently stay incomplete otherwise.
      const { label } = data as LabelEventData;
      const idx = host._labels.findIndex((l) => l.id === label.id);
      host._labels =
        idx === -1
          ? [...host._labels, label]
          : host._labels.map((l) => (l.id === label.id ? label : l));
      break;
    }
    case DeviceEventType.LABEL_DELETED: {
      const { label_id } = data as LabelDeletedEventData;
      host._labels = host._labels.filter((l) => l.id !== label_id);
      break;
    }
    case DeviceEventType.REMOTE_BUILD_IDENTITY_ROTATED:
    case DeviceEventType.REMOTE_BUILD_LISTENER_CHANGED: {
      host._buildServerIdentityRotationCounter += 1;
      break;
    }
    case DeviceEventType.REMOTE_BUILD_PAIR_REQUEST_RECEIVED: {
      const evt = data as RemoteBuildPairRequestReceivedEventData;
      const incoming: PeerSummary = {
        dashboard_id: evt.dashboard_id,
        pin_sha256: evt.pin_sha256,
        label: evt.label,
        paired_at: evt.paired_at,
        status: "pending",
        peer_ip: evt.peer_ip,
        connected: false,
        friendly_name: evt.friendly_name,
        ha_addon: evt.ha_addon,
        label_auto: evt.label_auto,
      };
      const current = host._buildServerPeers ?? [];
      const idx = current.findIndex((p) => p.dashboard_id === incoming.dashboard_id);
      host._buildServerPeers =
        idx === -1
          ? [...current, incoming]
          : [...current.slice(0, idx), incoming, ...current.slice(idx + 1)];
      break;
    }
    case DeviceEventType.REMOTE_BUILD_PAIR_STATUS_CHANGED: {
      const evt = data as RemoteBuildPairStatusChangedEventData;
      const current = host._buildServerPeers ?? [];
      if (evt.status === "removed") {
        host._buildServerPeers = current.filter(
          (p) => p.dashboard_id !== evt.dashboard_id
        );
      } else {
        host._buildServerPeers = current.map((p) =>
          p.dashboard_id === evt.dashboard_id ? { ...p, status: "approved" as const } : p
        );
      }
      break;
    }
    case DeviceEventType.RECEIVER_PEER_LINK_SESSION_OPENED: {
      // OPENED also refreshes the offloader's display identity —
      // the event carries the stored row's post-refresh values.
      if (host._buildServerPeers === null) break;
      const evt = data as ReceiverPeerLinkSessionOpenedEventData;
      host._buildServerPeers = host._buildServerPeers.map((p) =>
        p.dashboard_id === evt.dashboard_id
          ? {
              ...p,
              connected: true,
              ha_addon: evt.ha_addon,
              ...(evt.friendly_name ? { friendly_name: evt.friendly_name } : {}),
            }
          : p
      );
      break;
    }
    case DeviceEventType.RECEIVER_PEER_LINK_SESSION_CLOSED: {
      if (host._buildServerPeers === null) break;
      const evt = data as ReceiverPeerLinkSessionEventData;
      host._buildServerPeers = host._buildServerPeers.map((p) =>
        p.dashboard_id === evt.dashboard_id ? { ...p, connected: false } : p
      );
      break;
    }
    case DeviceEventType.REMOTE_BUILD_PAIRING_WINDOW_CHANGED: {
      host._buildServerPairingWindowState =
        data as RemoteBuildPairingWindowChangedEventData;
      break;
    }
    case DeviceEventType.REMOTE_BUILD_HOST_ADDED: {
      // Map.set preserves existing-key insertion position so a TXT refresh
      // on an existing host doesn't shuffle the rendered order.
      const evt = data as RemoteBuildHostAddedEventData;
      const next = new Map(host._buildOffloadDiscoveredHosts ?? []);
      next.set(evt.name, evt);
      host._buildOffloadDiscoveredHosts = next;
      break;
    }
    case DeviceEventType.REMOTE_BUILD_HOST_REMOVED: {
      const evt = data as RemoteBuildHostRemovedEventData;
      if (host._buildOffloadDiscoveredHosts === null) break;
      const next = new Map(host._buildOffloadDiscoveredHosts);
      next.delete(evt.name);
      host._buildOffloadDiscoveredHosts = next;
      break;
    }
    case DeviceEventType.OFFLOADER_PAIR_STATUS_CHANGED: {
      const evt = data as OffloaderPairStatusChangedEventData;
      if (evt.status === "removed") {
        if (host._buildOffloadPairings === null) break;
        const next = new Map(host._buildOffloadPairings);
        next.delete(evt.pin_sha256);
        host._buildOffloadPairings = next;
        break;
      }
      // PENDING→APPROVED: backend spawns the peer-link client now, so flip
      // `connecting` true; reset last_connect_error — the previous pairing's
      // error history is unrelated to the freshly-approved row.
      patchOffloadPairing(host, evt.pin_sha256, {
        status: "approved",
        connecting: true,
        connected: false,
        last_connect_error: "",
      });
      break;
    }
    case DeviceEventType.OFFLOADER_PAIRING_ADDED: {
      // Non-issuing tab builds the row from the event's full PairingSummary.
      // null map = snapshot not yet seeded; initial_state reseed carries it.
      if (host._buildOffloadPairings === null) break;
      const evt = data as OffloaderPairingAddedEventData;
      const next = new Map(host._buildOffloadPairings);
      next.set(evt.pin_sha256, evt);
      host._buildOffloadPairings = next;
      break;
    }
    case DeviceEventType.OFFLOADER_PEER_LINK_OPENED: {
      // OPENED clears the failure record: a successful session-open
      // invalidates whatever caused the previous close. friendly_name
      // patches non-empty-only (mirror of the backend persist policy)
      // so an older receiver can't blank a captured name.
      const evt = data as OffloaderPeerLinkOpenedEventData;
      patchOffloadPairing(host, evt.pin_sha256, {
        connected: true,
        connecting: false,
        last_connect_error: "",
        esphome_version: evt.esphome_version,
        auto_provision_supported: evt.auto_provision_supported,
        ha_addon: evt.ha_addon,
        reset_build_env_supported: evt.reset_build_env_supported,
        ...(evt.friendly_name ? { friendly_name: evt.friendly_name } : {}),
      });
      break;
    }
    case DeviceEventType.OFFLOADER_PEER_LINK_CLOSED: {
      // Orphan reasons (superseded / pin_mismatch) are terminal — the run loop
      // won't reconnect, so don't show "Connecting…". Everything else is a
      // transient close: connecting flips back to true while the loop backs off.
      const evt = data as OffloaderPeerLinkClosedEventData;
      const orphaned = evt.reason === "superseded" || evt.reason === "pin_mismatch";
      patchOffloadPairing(host, evt.pin_sha256, {
        connected: false,
        connecting: !orphaned,
        last_connect_error: evt.error_detail,
      });
      break;
    }
    case DeviceEventType.OFFLOADER_PAIR_PIN_MISMATCH: {
      const evt = data as OffloaderPairPinMismatchEventData;
      const next = new Map(host._buildOffloadAlerts ?? []);
      next.set(evt.pin_sha256, {
        kind: "pin_mismatch",
        receiver_hostname: evt.receiver_hostname,
        receiver_port: evt.receiver_port,
        pin_sha256: evt.pin_sha256,
        receiver_label: evt.receiver_label,
        expected_pin: evt.expected_pin,
        observed_pin: evt.observed_pin,
        fired_at: Date.now() / 1000,
      });
      host._buildOffloadAlerts = next;
      break;
    }
    case DeviceEventType.OFFLOADER_PAIR_PEER_REVOKED: {
      const evt = data as OffloaderPairPeerRevokedEventData;
      const next = new Map(host._buildOffloadAlerts ?? []);
      next.set(evt.pin_sha256, {
        kind: "peer_revoked",
        receiver_hostname: evt.receiver_hostname,
        receiver_port: evt.receiver_port,
        pin_sha256: evt.pin_sha256,
        receiver_label: evt.receiver_label,
        fired_at: Date.now() / 1000,
      });
      host._buildOffloadAlerts = next;
      break;
    }
    case DeviceEventType.OFFLOADER_PAIR_ALERT_DISMISSED: {
      const evt = data as OffloaderPairAlertDismissedEventData;
      if (host._buildOffloadAlerts === null) break;
      const next = new Map(host._buildOffloadAlerts);
      next.delete(evt.pin_sha256);
      host._buildOffloadAlerts = next;
      break;
    }
    case DeviceEventType.OFFLOADER_REMOTE_BUILDS_TOGGLED: {
      const evt = data as OffloaderRemoteBuildsToggledEventData;
      host._offloaderRemoteBuildsEnabled = evt.remote_builds_enabled;
      break;
    }
    case DeviceEventType.OFFLOADER_PAIRING_ENABLED_CHANGED: {
      const evt = data as OffloaderPairingEnabledChangedEventData;
      patchOffloadPairing(host, evt.pin_sha256, { enabled: evt.enabled });
      break;
    }
    case DeviceEventType.OFFLOADER_VERSION_MATCH_POLICY_CHANGED: {
      const evt = data as OffloaderVersionMatchPolicyChangedEventData;
      host._offloaderVersionMatchPolicy = evt.version_match_policy;
      break;
    }
    case DeviceEventType.OFFLOADER_INCLUDE_LOCAL_CHANGED: {
      const evt = data as OffloaderIncludeLocalChangedEventData;
      host._offloaderIncludeLocalInPool = evt.include_local_in_pool;
      break;
    }
    case DeviceEventType.OFFLOADER_JOB_STATE_CHANGED: {
      const evt = data as OffloaderJobStateChangedEventData;
      const base =
        host._buildOffloadJobs.get(evt.job_id) ??
        stubRemoteBuildJobState(evt.job_id, evt.pin_sha256);
      host._buildOffloadJobs = new Map(host._buildOffloadJobs).set(evt.job_id, {
        ...base,
        status: evt.status,
        error_message: evt.error_message,
      });
      break;
    }
    case DeviceEventType.OFFLOADER_JOB_OUTPUT: {
      const evt = data as OffloaderJobOutputEventData;
      const base =
        host._buildOffloadJobs.get(evt.job_id) ??
        stubRemoteBuildJobState(evt.job_id, evt.pin_sha256);
      host._buildOffloadJobs = new Map(host._buildOffloadJobs).set(evt.job_id, {
        ...base,
        output: [...base.output, evt.line],
      });
      break;
    }
  }
}
