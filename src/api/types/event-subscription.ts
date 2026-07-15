/**
 * subscribe_events result and pushed event payloads.
 *
 * Part of the src/api/types.ts barrel split.
 */
import {
  DeviceState,
  type AdoptableDevice,
  type ConfiguredDevice,
  type Label,
} from "./devices.js";
import { JobStatus, type FirmwareJob } from "./firmware-jobs.js";
import type { OffloaderAlertSnapshotEntry } from "./remote-build-events.js";
import type {
  PairingSummary,
  PeerSummary,
  RemoteBuildPeer,
  RemoteBuildSettings,
} from "./remote-build.js";
import type { UserPreferences } from "./system.js";

// ─── Event Subscription ─────────────────────────────────────

/** Result from subscribe_events command. */
export interface SubscribeEventsResult {
  subscribed: boolean;
}

/** Event types pushed by the backend after subscribe_events. */
export enum DeviceEventType {
  INITIAL_STATE = "initial_state",
  DEVICE_ADDED = "device_added",
  DEVICE_REMOVED = "device_removed",
  DEVICE_UPDATED = "device_updated",
  DEVICE_STATE_CHANGED = "device_state_changed",
  IMPORTABLE_DEVICE_ADDED = "importable_device_added",
  IMPORTABLE_DEVICE_REMOVED = "importable_device_removed",
  // Label catalog mutations. Per-device label assignment changes
  // ride the existing ``DEVICE_UPDATED`` event.
  LABEL_CREATED = "label_created",
  LABEL_UPDATED = "label_updated",
  LABEL_DELETED = "label_deleted",
  JOB_QUEUED = "job_queued",
  JOB_STARTED = "job_started",
  JOB_OUTPUT = "job_output",
  JOB_COMPLETED = "job_completed",
  JOB_FAILED = "job_failed",
  // Remote-build events.
  REMOTE_BUILD_IDENTITY_ROTATED = "remote_build_identity_rotated",
  REMOTE_BUILD_LISTENER_CHANGED = "remote_build_listener_changed",
  REMOTE_BUILD_PAIR_REQUEST_RECEIVED = "remote_build_pair_request_received",
  REMOTE_BUILD_PAIR_STATUS_CHANGED = "remote_build_pair_status_changed",
  REMOTE_BUILD_PAIRING_WINDOW_CHANGED = "remote_build_pairing_window_changed",
  // Offloader-side counterpart to ``REMOTE_BUILD_PAIR_STATUS_CHANGED``;
  // fires from the offloader's pair-status listener task and from
  // ``remote_build/unpair``.
  OFFLOADER_PAIR_STATUS_CHANGED = "offloader_pair_status_changed",
  // Offloader pairing row created by ``remote_build/request_pair``;
  // OFFLOADER_PAIR_STATUS_CHANGED only flips an already-known row, so
  // this event is what lets a second connected tab build the new row.
  OFFLOADER_PAIRING_ADDED = "offloader_pairing_added",
  // Receiver-side peer-link session lifecycle. Fired by the
  // receiver's ``register_peer_link_session`` /
  // ``unregister_peer_link_session`` hooks when a 5a-2 offloader
  // client connects / disconnects. Drives the
  // ``PeerSummary.connected`` indicator on the receiver-side
  // Paired senders list. Payload is just the ``dashboard_id``;
  // the matching row is found by lookup against
  // ``_buildServerPeers``.
  RECEIVER_PEER_LINK_SESSION_OPENED = "receiver_peer_link_session_opened",
  RECEIVER_PEER_LINK_SESSION_CLOSED = "receiver_peer_link_session_closed",
  // Offloader-side peer-link session lifecycle. Fired by the
  // offloader's long-lived PeerLinkClient when its Noise WS
  // to the receiver enters / leaves the post-handshake parked
  // state. Drives the PairingSummary.connected indicator on
  // the offloader-side Paired-build-servers list. Both events
  // share the OffloaderPeerLinkSessionEventData identity base;
  // OPENED adds esphome_version, CLOSED adds reason/error_detail.
  OFFLOADER_PEER_LINK_OPENED = "offloader_peer_link_opened",
  OFFLOADER_PEER_LINK_CLOSED = "offloader_peer_link_closed",
  // Offloader-side remote-build job lifecycle. Fired by the
  // offloader's PeerLinkClient receive loop when an inbound
  // job_state_changed / job_output frame lands from the
  // paired receiver this dashboard submitted the job to. The
  // offloader doesn't own a FirmwareJob row for these (the
  // receiver runs the build); it just fans the wire frames
  // onto its local bus so subscribe_events re-broadcasts to
  // frontend tabs. Settings dialog's Send-builds section
  // consumes both to render the live progress drawer per
  // in-flight remote job: STATE_CHANGED drives the lifecycle
  // pill (queued / running / completed / failed / cancelled),
  // OUTPUT appends each per-line stdout / stderr chunk to the
  // ansi-log buffer. Phase 5c-3 wired the backend.
  OFFLOADER_JOB_STATE_CHANGED = "offloader_job_state_changed",
  OFFLOADER_JOB_OUTPUT = "offloader_job_output",
  // mDNS-discovered peer dashboards. Replaces the deleted
  // ``remote_build/list_hosts`` WS command — the controller fires
  // these events as its mDNS browser callback resolves /
  // forgets entries, and the ``subscribe_events`` initial-state
  // push carries the current set under ``hosts`` so a fresh tab
  // paints without a round-trip.
  REMOTE_BUILD_HOST_ADDED = "remote_build_host_added",
  REMOTE_BUILD_HOST_REMOVED = "remote_build_host_removed",
  // Offloader-side pair alerts. Backend's pair-status listener
  // fires PIN_MISMATCH (the receiver's static X25519 pubkey
  // hash drifted from the stored ``StoredPairing.pin_sha256``)
  // or PEER_REVOKED (the receiver returned ``rejected``) when
  // a pair-status round-trip resolves a broken pairing. ALERT
  // _DISMISSED fires when the alert clears via re-pair (auto-
  // resolved by ``request_pair`` succeeding for the same
  // ``${hostname}:${port}``) or ``unpair``. There is no
  // operator-driven dismiss — clicking "OK got it" without
  // acting would just hide a broken pairing the next peer-
  // link session would still fail against. Late-subscribers
  // pick up missed alerts via
  // ``subscribe_events.initial_state.offloader_alerts``.
  OFFLOADER_PAIR_PIN_MISMATCH = "offloader_pair_pin_mismatch",
  OFFLOADER_PAIR_PEER_REVOKED = "offloader_pair_peer_revoked",
  OFFLOADER_PAIR_ALERT_DISMISSED = "offloader_pair_alert_dismissed",
  // 7b — offloader Settings UI toggles for the transparent
  // install flow. ``OFFLOADER_REMOTE_BUILDS_TOGGLED`` fires when
  // the dashboard-wide "Remote builds enabled" master switch
  // flips; ``OFFLOADER_PAIRING_ENABLED_CHANGED`` fires when one
  // pairing's per-row enable switch flips. Both are emitted by
  // the matching WS setters (``remote_build/set_offloader_settings``
  // and ``remote_build/set_pairing_enabled``) so other open tabs
  // sync their switch state without polling.
  OFFLOADER_REMOTE_BUILDS_TOGGLED = "offloader_remote_builds_toggled",
  OFFLOADER_PAIRING_ENABLED_CHANGED = "offloader_pairing_enabled_changed",
  // Master version-match policy change.
  OFFLOADER_VERSION_MATCH_POLICY_CHANGED = "offloader_version_match_policy_changed",
  // "Include local in build pool" advanced toggle change.
  OFFLOADER_INCLUDE_LOCAL_CHANGED = "offloader_include_local_changed",
}

/**
 * How strictly the offloader filters paired peers by ESPHome
 * version when picking a build path. ``exact_required`` is the
 * only value that hard-fails the install (raises
 * ``no_compatible_peer``) instead of falling back to LOCAL
 * when no peer survives the filter. See the backend
 * ``VersionMatchPolicy`` enum + ``set_offloader_settings`` for
 * the full per-value contract.
 */
export type VersionMatchPolicy = "any" | "release" | "exact" | "exact_required";

/** Data payload for job lifecycle events (queued, started, completed, failed). */
export interface JobEventData {
  job: FirmwareJob;
}

/** Data payload for job_output event. */
export interface JobOutputEventData {
  job_id: string;
  line: string;
}

/** Data payload for initial_state event. */
export interface InitialStateEventData {
  /** User preferences snapshot. Always sent (the backend reads defaults when
   *  nothing is stored), so the type is required — lockstep deployment rules out
   *  version skew. The ``experience_level`` and ``remote_compute_only`` fields
   *  gate first-paint UI, so they ride the subscription snapshot rather than a
   *  separate ``config/get_preferences`` round-trip; the app shell marks
   *  ``_prefsLoaded`` from this and stops failing device creation closed. */
  preferences: UserPreferences;
  devices: ConfiguredDevice[];
  /** Discovered factory-firmware devices the dashboard knew about
   *  before this client subscribed. The backend follows up with
   *  ``IMPORTABLE_DEVICE_ADDED`` / ``_REMOVED`` events for changes
   *  after subscription. */
  importable: AdoptableDevice[];
  /** Offloader-side pairings snapshot the backend pushes once at
   *  subscribe time so the Send-builds initial paint matches what
   *  ``OFFLOADER_PAIR_STATUS_CHANGED`` events will subsequently
   *  mutate against. Carries both PENDING and APPROVED rows from
   *  the controller's in-RAM ``_pairings`` dict (sync read; no
   *  wire calls, no disk I/O). Optional because not every
   *  dashboard has a remote-build controller wired up — when
   *  the controller is absent the field is omitted entirely
   *  rather than sent as an empty list. */
  pairings?: PairingSummary[];
  /** Receiver-side peers snapshot. Carries both PENDING (in the
   *  receiver's in-memory ``_pending_peers`` dict, awaiting
   *  Accept / Reject) and APPROVED (persisted) rows. Live updates
   *  flow through the same ``subscribe_events`` stream as
   *  ``REMOTE_BUILD_PAIR_REQUEST_RECEIVED`` (upsert),
   *  ``REMOTE_BUILD_PAIR_STATUS_CHANGED`` (status flip / row
   *  drop) events. Optional for the same reason as
   *  ``pairings`` — absent controller, omitted field. */
  peers?: PeerSummary[];
  /** Receiver-side mDNS-discovered hosts snapshot. RAM-only on
   *  the backend; a sibling-of-RAM map populated by the
   *  ``_esphomebuilder._tcp.local.`` browser callback. Replaces
   *  the deleted ``remote_build/list_hosts`` command. Live
   *  updates flow through ``REMOTE_BUILD_HOST_ADDED`` (upsert
   *  by ``name``) and ``REMOTE_BUILD_HOST_REMOVED`` (drop by
   *  ``name``). Optional for the same reason as ``pairings`` /
   *  ``peers`` — absent controller, omitted field. */
  hosts?: RemoteBuildPeer[];
  /** Offloader-side pair alerts snapshot. RAM-only on the
   *  backend; populated when ``OFFLOADER_PAIR_PIN_MISMATCH`` /
   *  ``OFFLOADER_PAIR_PEER_REVOKED`` fires and cleared when
   *  ``OFFLOADER_PAIR_ALERT_DISMISSED`` fires. The two
   *  resolution paths (re-pair / unpair) auto-fire the
   *  dismissed event; there is no operator-driven dismiss
   *  surface. Late-subscribing clients pick up alerts that
   *  fired before they connected via this snapshot. Optional
   *  for the same reason as ``pairings`` / ``peers`` —
   *  absent controller, omitted field. */
  offloader_alerts?: OffloaderAlertSnapshotEntry[];
  /** Offloader-side in-flight remote-build jobs snapshot.
   *  RAM-only on the backend; populated as
   *  ``OFFLOADER_JOB_STATE_CHANGED`` events upsert rows by
   *  ``job_id`` and dropped when a terminal event (completed /
   *  failed / cancelled) fires. Lets a tab subscribing AFTER
   *  a ``running`` transition (page reload mid-build, second
   *  tab opened after dispatch) repaint the live build
   *  without waiting for the next event. Output buffer isn't
   *  in the snapshot — the receiver doesn't replay; the next
   *  ``OFFLOADER_JOB_OUTPUT`` line repopulates from the
   *  point-of-subscribe forward. Display fields
   *  (configuration / target / receiver_label) aren't carried
   *  either — the receiver doesn't echo them, so reload-time
   *  rows show empty strings until terminal (the dialog's
   *  re-attach view tolerates them). Optional for the same
   *  reason as ``pairings`` / ``peers`` — absent controller,
   *  omitted field. */
  remote_jobs?: OffloaderRemoteJobSnapshotEntry[];
  /** Receiver-side settings scalars (RAM-canonical on the backend's
   *  ReceiverState). Seed the Build server panel's first paint;
   *  updates keep flowing through the loadRemoteBuildSettings
   *  refreshes. Optional for the same reason as `peers` — absent
   *  controller, omitted field. */
  remote_build_settings?: Pick<RemoteBuildSettings, "enabled" | "cleanup_ttl_seconds">;
  /** Firmware-jobs snapshot: the same rows follow_jobs would replay
   *  (created_at order, output omitted), seeding the queue in one
   *  shot. Optional for the same reason as above; follow_jobs stays
   *  the live-update stream. */
  firmware_jobs?: FirmwareJob[];
  /** Offloader-side master "Remote builds enabled" toggle (7b).
   *  When `false`, the backend's ``pick_build_path`` short-
   *  circuits every install to LOCAL; paired peer-link
   *  sessions stay open and the Send-builds power-user dialog
   *  still works — only the implicit auto-route is gated.
   *  Live updates flow through
   *  ``OFFLOADER_REMOTE_BUILDS_TOGGLED`` events. Optional for
   *  the same reason as ``pairings`` / ``peers`` — absent
   *  controller, omitted field. Defaults to `true` on a fresh
   *  install (matches the pre-7b semantic where any APPROVED
   *  + connected + idle pairing was eligible). */
  remote_builds_enabled?: boolean;
  /** Offloader-side master version-match policy. See
   *  :type:`VersionMatchPolicy` for the per-value semantics. */
  version_match_policy?: VersionMatchPolicy;
  /** Advanced: when set, the local machine joins the build pool
   *  and compiles overflow once every paired server is busy.
   *  Optional for the same reason as the fields above; defaults
   *  to `false`. Live updates flow through
   *  ``OFFLOADER_INCLUDE_LOCAL_CHANGED``. */
  include_local_in_pool?: boolean;
}

/**
 * Snapshot row in the offloader-side in-flight remote-build
 * jobs cache. Mirror of the backend's
 * :class:`OffloaderRemoteJobSnapshotEntry` TypedDict (see
 * ``models/remote_build.py``). Carries enough to render the
 * lifecycle pill on a late-subscribing tab; display fields
 * (configuration / target / receiver_label) and the output
 * buffer are deliberately absent — the receiver doesn't echo
 * the display fields back through the wire, and the output
 * buffer would balloon the snapshot for any in-flight build.
 */
export interface OffloaderRemoteJobSnapshotEntry {
  receiver_hostname: string;
  receiver_port: number;
  pin_sha256: string;
  job_id: string;
  status: JobStatus;
  error_message: string;
}

/** Data payload for device_added / device_updated / device_removed events. */
export interface DeviceEventData {
  device: ConfiguredDevice;
}

/** Data payload for device_state_changed event. */
export interface DeviceStateChangedEventData {
  configuration: string;
  state: DeviceState;
}

/** Data payload for importable_device_added events. */
export interface ImportableDeviceAddedEventData {
  device: AdoptableDevice;
}

/** Data payload for importable_device_removed events.
 *
 *  Removal carries only the device name — by the time the event
 *  fires the original ``AdoptableDevice`` is gone from the backend's
 *  ``import_result`` cache, and the frontend doesn't need anything
 *  beyond the name to evict its own copy. */
export interface ImportableDeviceRemovedEventData {
  name: string;
}

/** Data payload for label_created / label_updated events. */
export interface LabelEventData {
  label: Label;
}

/** Data payload for label_deleted events. The catalog entry is
 *  already gone by the time this fires; per-device assignments
 *  cascade through the existing ``device_updated`` events. */
export interface LabelDeletedEventData {
  label_id: string;
}

/** Callback for event subscription push events. */
export type EventSubscriptionCallback = (event: string, data: unknown) => void;
