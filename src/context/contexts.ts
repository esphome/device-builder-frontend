/**
 * Lit Context definitions for passing data through the component tree.
 *
 * Uses @lit/context to provide reactive context values
 * without prop-drilling through intermediate components.
 */
import { createContext } from "@lit/context";
import { ESPHomeAPI } from "../api/index.js";
import {
  JobStatus,
  JobType,
  type AdoptableDevice,
  type ConfiguredDevice,
  type FirmwareJob,
  type Label,
  type OffloaderAlertSnapshotEntry,
  type PairingSummary,
  type PairingWindowState,
  type PeerSummary,
  type RemoteBuildPeer,
  type RemoteBuildSubmitTarget,
} from "../api/types.js";
import type { LocalizeFunc } from "../common/localize.js";

/** Context for the ESPHome API client instance. */
export const apiContext = createContext<ESPHomeAPI>(Symbol("esphome-api"));

/** Context for the list of configured devices. */
export const devicesContext = createContext<ConfiguredDevice[]>(
  Symbol("esphome-devices")
);

/** Context for the list of importable/adoptable devices. */
export const importableDevicesContext = createContext<AdoptableDevice[]>(
  Symbol("esphome-importable-devices")
);

/** Context for the ESPHome version string. */
export const versionContext = createContext<string>(Symbol("esphome-version"));

/** Context for the Device Builder server version string. */
export const serverVersionContext = createContext<string>(
  Symbol("esphome-server-version")
);

/** Context for dark mode state. */
export const darkModeContext = createContext<boolean>(Symbol("esphome-dark-mode"));

/** Context for the localize function. */
export const localizeContext = createContext<LocalizeFunc>(Symbol("esphome-localize"));

/** Context for whether the initial device list has been loaded. */
export const devicesLoadedContext = createContext<boolean>(
  Symbol("esphome-devices-loaded")
);

/** Context for whether the frontend is running inside HA ingress. */
export const isHaIngressContext = createContext<boolean>(Symbol("esphome-is-ha-ingress"));

/** Context for active firmware jobs, keyed by device configuration.
 *  Tracks the latest non-terminal job per device (used for the busy
 *  spinner on cards/tables). For the full multi-job view, see
 *  `firmwareJobsContext`. */
export const activeJobsContext = createContext<Map<string, FirmwareJob>>(
  Symbol("esphome-active-jobs")
);

/** Context for jobs that just finished, keyed by device configuration.
 *  Holds the terminal job for ~30s after `_terminateJob` so the
 *  cards/tables can show a transient success/failure indicator before
 *  reverting to the regular online/offline state. */
export const recentJobsContext = createContext<Map<string, FirmwareJob>>(
  Symbol("esphome-recent-jobs")
);

/** Context for every firmware job the backend currently exposes
 *  (active and the trimmed terminal history), keyed by `job_id`.
 *  Powers the firmware-tasks dialog — a device can have several jobs
 *  in flight (e.g. compile + clean queued back-to-back), so we key
 *  by job_id to keep them all distinct. */
export const firmwareJobsContext = createContext<Map<string, FirmwareJob>>(
  Symbol("esphome-firmware-jobs")
);

/** Context for whether the YAML diff button is enabled in the editor. */
export const yamlDiffButtonContext = createContext<boolean>(
  Symbol("esphome-yaml-diff-button")
);

/**
 * Context for the receiver-side remote-build master switch.
 *
 * Phase 2 of the remote-build feature (issue #106). Off by
 * default; the value comes from the backend on startup via
 * ``remote_build/get_settings`` and is updated when the user
 * flips the toggle in Settings → Remote builder. Phase 3+ adds
 * the rest of the receiver-side knobs (identity fingerprint,
 * artifact-retention TTL, etc.) — this single boolean is the
 * scaffolding the Settings UI plugs the rest into.
 */
export const remoteBuildEnabledContext = createContext<boolean>(
  Symbol("esphome-remote-build-enabled")
);

/**
 * Receiver-side cleanup-sweep TTL (seconds).
 *
 * 6c knob that controls how long a cold remote-build subtree
 * lingers before the receiver's background sweep reclaims it.
 * Loaded alongside the master enable toggle from
 * ``remote_build/get_settings``; updated whenever the operator
 * commits the input in Settings → Build server. App-shell
 * provides the value; the settings dialog consumes + renders
 * an hours input. Default is 24h
 * (``CLEANUP_TTL_DEFAULT_SECONDS``).
 */
export const remoteBuildCleanupTtlContext = createContext<number>(
  Symbol("esphome-remote-build-cleanup-ttl")
);

/** Context for the integration → esphome.io docs URL map. Populated
 *  once on app load via ``components/get_integration_docs``; the
 *  drawer's loaded-integration tags consult it to decide whether to
 *  render each name as a link or plain text. */
export const integrationDocsContext = createContext<Record<string, string>>(
  Symbol("esphome-integration-docs")
);

/** Context for the global label catalog. Loaded once via
 *  ``labels/list`` on (re)connect and kept in sync via the
 *  ``label_created`` / ``label_updated`` / ``label_deleted`` push
 *  events. Per-device assignments live on each
 *  ``ConfiguredDevice.labels`` (an array of ids); consumers join
 *  against this map at render time to resolve name + color. */
export const labelsContext = createContext<Label[]>(Symbol("esphome-labels"));

/**
 * Context for whether onboarding still has work to do.
 *
 * App shell loads ``onboarding/get_state`` on (re)connect and
 * after every ``secrets-saved`` event, providing ``true`` when
 * any step is data-derived ``pending`` (currently only the
 * Wi-Fi step). Header-actions consumes it to gate a dedicated
 * ``Set up Wi-Fi…`` kebab entry — the persistent re-entry path
 * for a user who declined the wizard with "I don't use Wi-Fi"
 * but might later change their mind, or who hand-cleared
 * ``wifi_ssid`` in the secrets editor.
 */
export const onboardingPendingContext = createContext<boolean>(
  Symbol("esphome-onboarding-pending")
);

/**
 * Counter that increments whenever the cached ``IdentityView``
 * may have gone stale; the Build server settings card watches
 * the counter and re-fetches identity when it changes. Phase
 * 3c2d (#106).
 *
 * Bump sites:
 * * 'remote_build_identity_rotated' event lands a new X25519
 *   public-key fingerprint; another tab triggered a rotation
 *   we want to mirror.
 * * The user toggles the "Enable remote build" switch
 *   (``setRemoteBuildSettings``); ``IdentityView.listener_bound``
 *   flips alongside the runner teardown / re-bind so the cached
 *   view goes stale immediately.
 *
 * A counter rather than the event payload because the
 * IdentityView model carries fields the events don't
 * (``listener_bound``, versions); a re-fetch is the simplest
 * way to pick those up regardless of which path invalidated
 * it. Settings dialog reacts to the value going up; the
 * specific number doesn't matter.
 */
export const buildServerIdentityRotationCounterContext = createContext<number>(
  Symbol("esphome-build-server-identity-rotation-counter")
);

/**
 * Receiver-side peer list (PENDING + APPROVED), seeded from
 * ``subscribe_events``'s ``initial_state.peers`` snapshot at
 * subscribe time and mutated locally as events arrive
 * (``remote_build_pair_request_received`` upserts;
 * ``remote_build_pair_status_changed`` flips a row's status to
 * approved or drops it on removed). Phase 4b-2 (#106).
 *
 * ``null`` until the initial-state snapshot lands so the
 * Settings UI can distinguish "no controller" / "still
 * loading" from "loaded with zero rows". The Settings dialog's
 * Pairing requests subsection consumes this directly — no
 * separate refetch path.
 */
export const buildServerPeersContext = createContext<PeerSummary[] | null>(
  Symbol("esphome-build-server-peers")
);

/**
 * Latest receiver-side pairing-window state, sourced from
 * ``remote_build_pairing_window_changed`` events. Phase 4b-2
 * (#106).
 *
 * ``null`` until the first event lands (or until the Settings
 * dialog's Build server section runs its initial
 * ``setRemoteBuildPairingWindow`` call); thereafter mirrors the
 * receiver's view: ``open: true`` while at least one client is
 * extending, ``open: false`` once everyone backs off and the
 * idle timer expires. Settings UI renders an "open / closed"
 * pill from this; the payload also carries
 * ``expires_in_seconds``, but the UI doesn't yet surface a
 * countdown — that's a follow-up. The frontend uses this
 * context for read-only display; mutations (open / close /
 * extend) go through the WS command directly so the wire
 * acknowledgement is round-tripped before the local state
 * updates.
 */
export const buildServerPairingWindowStateContext =
  createContext<PairingWindowState | null>(
    Symbol("esphome-build-server-pairing-window-state")
  );

/**
 * mDNS-discovered peer dashboards (offload-side discovery
 * surface), seeded from ``subscribe_events``'s
 * ``initial_state.hosts`` snapshot at subscribe time and
 * mutated locally as ``remote_build_host_added`` (upsert by
 * ``name``) / ``remote_build_host_removed`` (drop by ``name``)
 * events arrive. Replaces the deleted ``remote_build/list_hosts``
 * pull surface — RAM-only on the backend, push-driven on the
 * frontend.
 *
 * ``null`` until the initial-state snapshot lands so consumers
 * can distinguish "no controller / still loading" from "loaded
 * with zero discovered hosts". The Send-builds Settings
 * subsection (and the future offloader-side pair dialog)
 * consume this directly. The shape is a :class:`Map` (rather
 * than a plain object) keyed on ``name`` (the leftmost mDNS
 * service-instance label) for two reasons: (a) ``name`` comes
 * off the network and a malicious mDNS responder broadcasting
 * a service-instance label like ``__proto__`` or
 * ``constructor`` would collide with prototype keys on a plain
 * ``{}``; (b) ``Map`` preserves insertion order verbatim,
 * whereas plain objects re-order numeric-looking keys (e.g.
 * a host literally named ``"42"`` would float ahead of the
 * alphabetic neighbours during enumeration), which would
 * surface as inconsistent UI ordering between snapshot and
 * post-event renders.
 */
export const buildOffloadDiscoveredHostsContext = createContext<Map<
  string,
  RemoteBuildPeer
> | null>(Symbol("esphome-build-offload-discovered-hosts"));

/**
 * Offloader-side pairings (PENDING + APPROVED rows from the
 * controller's in-RAM ``_pairings`` dict, projected to
 * ``PairingSummary``). Seeded from
 * ``subscribe_events.initial_state.pairings`` at subscribe
 * time and mutated locally as ``OFFLOADER_PAIR_STATUS_CHANGED``
 * events arrive (status flip on ``"approved"``, row drop on
 * ``"removed"``).
 *
 * Keyed on ``${hostname}:${port}`` because that's what the
 * backend's ``StoredPairing`` is keyed on (the receiver's
 * ``dashboard_id`` isn't visible to the offloader; the
 * receiver coordinates the user typed are the stable id).
 * :class:`Map` for the same reasons
 * :member:`buildOffloadDiscoveredHostsContext` is — these are
 * user-supplied or network-supplied strings, and we want
 * insertion-ordered iteration without prototype-key
 * footguns.
 *
 * ``null`` until the initial-state snapshot lands so consumers
 * can distinguish "no controller / still loading" from "loaded
 * with zero rows". The Send-builds Settings subsection
 * consumes this directly to render the paired-receivers list,
 * and the pair dialog consumes it to auto-close on a matching
 * ``OFFLOADER_PAIR_STATUS_CHANGED`` after a sent
 * ``request_pair``.
 */
export const buildOffloadPairingsContext = createContext<Map<
  string,
  PairingSummary
> | null>(Symbol("esphome-build-offload-pairings"));

/**
 * Offloader-side master "Remote builds enabled" toggle (7b).
 *
 * When `false`, the backend's ``pick_build_path`` short-
 * circuits every install to LOCAL — paired peer-link sessions
 * stay open and the Send-builds power-user dialog still works,
 * only the implicit auto-route is gated. Seeded from
 * ``subscribe_events.initial_state.remote_builds_enabled`` and
 * mutated locally on ``OFFLOADER_REMOTE_BUILDS_TOGGLED`` events
 * fired by any tab's ``set_offloader_settings`` write.
 *
 * ``null`` until the snapshot lands (controller may not be
 * wired up, or the WS is still connecting) so the Settings UI
 * can distinguish "still loading" from a deliberate `false`
 * state. Defaults to `true` on a fresh dashboard (matches the
 * pre-7b semantic where any APPROVED + connected + idle
 * pairing was eligible).
 */
export const offloaderRemoteBuildsEnabledContext = createContext<boolean | null>(
  Symbol("esphome-offloader-remote-builds-enabled")
);

/**
 * Offloader-side pair alerts (pin_mismatch / peer_revoked).
 * Keyed on ``${hostname}:${port}`` to match the backend's
 * ``_offloader_alerts`` dict. Seeded from
 * ``subscribe_events.initial_state.offloader_alerts`` and
 * mutated locally on the three live events:
 * ``OFFLOADER_PAIR_PIN_MISMATCH`` (upsert with kind=
 * pin_mismatch), ``OFFLOADER_PAIR_PEER_REVOKED`` (upsert
 * with kind=peer_revoked), ``OFFLOADER_PAIR_ALERT_DISMISSED``
 * (drop by key).
 *
 * The alert describes a broken pairing; only the two
 * resolution paths clear it (re-pair fixes the underlying
 * state via ``request_pair``; unpair removes the row). No
 * operator-driven dismiss surface — clicking "OK got it"
 * without acting would just hide the broken state, which
 * the next peer-link session would surface again anyway.
 *
 * ``Map`` (not plain object) for the same reasons
 * ``buildOffloadDiscoveredHostsContext`` and
 * ``buildOffloadPairingsContext`` are: keys are user /
 * network-supplied strings, insertion order needs to be
 * stable, and ``Map`` avoids the prototype-key collisions a
 * plain object would have on those keys. ``null`` until the
 * snapshot lands so consumers can distinguish "no
 * controller / still loading" from "loaded with zero
 * alerts".
 */
export const buildOffloadAlertsContext = createContext<Map<
  string,
  OffloaderAlertSnapshotEntry
> | null>(Symbol("esphome-build-offload-alerts"));

/**
 * One in-flight (or recently terminal) remote-build job the
 * offloader's user dispatched via remote_build/submit_job.
 *
 * The receiver runs the build; the offloader doesn't own a
 * FirmwareJob row for these. App-shell maintains a Map keyed
 * on job_id, upserting on OFFLOADER_JOB_STATE_CHANGED and
 * appending output on OFFLOADER_JOB_OUTPUT.
 *
 * Display fields (configuration, target, receiver_label) come
 * from the submit_job call site rather than the wire frame
 * because the receiver doesn't echo them back; app-shell
 * gets them by listening to the submit dialog's success event
 * (or by retaining what submit_job's caller passed in).
 *
 * Snapshot-seeded from
 * ``subscribe_events.initial_state.remote_jobs`` so a page
 * reload mid-build paints the lifecycle pill immediately
 * instead of waiting for the next event. The snapshot doesn't
 * carry the output buffer (would balloon for any in-flight
 * compile) or the display fields (configuration / target /
 * receiver_label — the receiver doesn't echo them through the
 * wire), so reload-time rows start with an empty output buffer
 * and empty display strings; the dialog's re-attach view
 * tolerates the empty fields and live OFFLOADER_JOB_OUTPUT
 * events repopulate from the subscribe point forward. The
 * cache is offloader-side: receiver owns the underlying
 * FirmwareJob row, the offloader keeps a thin projection of
 * what's needed to render its in-flight UI.
 */
export interface RemoteBuildJobState {
  job_id: string;
  pin_sha256: string;
  receiver_label: string;
  configuration: string;
  target: RemoteBuildSubmitTarget;
  status: JobStatus;
  error_message: string;
  output: string[];
  /** Client-side monotonic timestamp; absent until the
   *  submit dialog seeds the entry (live event before
   *  seeding leaves it 0). */
  started_at: number;
}

/**
 * Context for in-flight remote-build jobs the offloader's
 * user dispatched. Keyed on job_id. null until app-shell
 * initialises (always immediately on app boot today, but
 * keeps the same null-vs-empty distinction sibling contexts
 * use for "still loading" vs "loaded but empty").
 */
export const buildOffloadJobsContext = createContext<Map<
  string,
  RemoteBuildJobState
> | null>(Symbol("esphome-build-offload-jobs"));

/**
 * Build a fresh RemoteBuildJobState with empty display
 * fields, used by app-shell when an event arrives before the
 * dispatch dialog has stamped the entry.
 *
 * The dispatch helper (registerRemoteBuildJob on app-shell)
 * backfills configuration / target / receiver_label /
 * started_at on its success bubble; until then the dialog
 * tolerates the empty strings.
 */
export function stubRemoteBuildJobState(
  job_id: string,
  pin_sha256: string
): RemoteBuildJobState {
  return {
    job_id,
    pin_sha256,
    receiver_label: "",
    configuration: "",
    target: JobType.COMPILE as RemoteBuildSubmitTarget,
    status: JobStatus.QUEUED,
    error_message: "",
    output: [],
    started_at: 0,
  };
}
