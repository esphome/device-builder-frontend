/**
 * Remote-build / offloader pushed event payloads.
 *
 * Part of the src/api/types.ts barrel split.
 */
import type { VersionMatchPolicy } from "./event-subscription.js";
import { JobStatus, JobStream } from "./firmware-jobs.js";
import type {
  PairingSummary,
  PairingWindowState,
  RemoteBuildPeer,
} from "./remote-build.js";

/**
 * Data payload for the ``remote_build_pair_request_received`` event.
 *
 * Fires on the receiver-side bus when a fresh
 * ``intent="pair_request"`` Noise frame lands inside an open
 * pairing window. The Settings UI surfaces the row in the
 * Pairing requests inbox; ``peer_ip`` lets the operator
 * sanity-check the source against expectations before
 * OOB-confirming the pin.
 *
 * ``paired_at`` carries the receiver-clock timestamp the row
 * was created at — same value the receiver writes to
 * ``StoredPeer.paired_at``. Sent on the event so the frontend
 * can construct a complete ``PeerSummary``-equivalent row from
 * the event alone (no follow-up read).
 */
export interface RemoteBuildPairRequestReceivedEventData {
  dashboard_id: string;
  pin_sha256: string;
  label: string;
  peer_ip: string;
  paired_at: number;
}

/**
 * Data payload for the ``remote_build_pair_status_changed`` event.
 *
 * Receiver-side. Fires from three paths: ``approve_peer``
 * promoting a PENDING dict entry to APPROVED
 * (``status="approved"``); ``remove_peer`` dropping either a
 * PENDING dict entry or an APPROVED list row
 * (``status="removed"``); pairing-window-close clearing the
 * in-memory PENDING dict (``status="removed"`` per cleared
 * entry). The ``status="removed"`` event is what wakes any
 * in-flight ``intent="pair_status"`` long-poll on a paired
 * offloader so its listener task drops the offloader's local
 * state.
 */
export interface RemoteBuildPairStatusChangedEventData {
  dashboard_id: string;
  status: "approved" | "removed";
}

/**
 * Data payload for the ``remote_build_pairing_window_changed``
 * event.
 *
 * Receiver-side. Fires whenever the in-process pairing window
 * opens, extends, or closes. Same shape as
 * ``PairingWindowState``; the Settings UI re-syncs its local
 * countdown against ``expires_in_seconds`` on every event tick.
 */
export type RemoteBuildPairingWindowChangedEventData = PairingWindowState;

/**
 * Data payload for the ``offloader_pair_status_changed`` event.
 *
 * Offloader-side counterpart to
 * ``RemoteBuildPairStatusChangedEventData``. Fired by the
 * offloader's per-row pair-status listener task
 * (``_apply_pair_status_result`` → ``_fire_offloader_pair_status_changed``)
 * and by ``remote_build/unpair`` when the user removes a row.
 * Keys on the receiver coordinates (``hostname`` /
 * ``port``) the user dialled because the offloader's
 * ``StoredPairing`` doesn't store the receiver's
 * ``dashboard_id``.
 */
export interface OffloaderPairStatusChangedEventData {
  receiver_hostname: string;
  receiver_port: number;
  /**
   * Stable cryptographic identifier the offloader-side
   * controller keys ``_pairings`` on (4a-o part 6 — re-keyed
   * offloader state from ``(host, port)`` to ``pin_sha256``);
   * frontend handlers should look up the matching
   * ``PairingSummary`` row by pin rather than by host/port to
   * stay correct across receiver hostname changes.
   */
  pin_sha256: string;
  status: "approved" | "removed";
}

/**
 * Data payload for the ``offloader_pairing_added`` event. Carries the
 * full ``PairingSummary`` on create so a connected tab builds the row.
 */
export type OffloaderPairingAddedEventData = PairingSummary;

/**
 * Data payload for the ``offloader_remote_builds_toggled`` event
 * (7b).
 *
 * Fires when the offloader's master "Remote builds enabled"
 * switch flips through ``remote_build/set_offloader_settings``.
 * Carries the new value so subscribing tabs can update their
 * switch render without re-fetching settings.
 */
export interface OffloaderRemoteBuildsToggledEventData {
  remote_builds_enabled: boolean;
}

/**
 * Data payload for the ``offloader_pairing_enabled_changed``
 * event (7b).
 *
 * Fires when one pairing's per-row enable switch flips
 * through ``remote_build/set_pairing_enabled``. App-shell
 * looks up the matching ``PairingSummary`` row in
 * ``_buildOffloadPairings`` keyed on ``pin_sha256`` and flips
 * ``enabled`` so other open tabs render the new switch state.
 */
export interface OffloaderPairingEnabledChangedEventData {
  pin_sha256: string;
  enabled: boolean;
}

/** Data payload for ``offloader_version_match_policy_changed``. */
export interface OffloaderVersionMatchPolicyChangedEventData {
  version_match_policy: VersionMatchPolicy;
}

/**
 * Data payload for ``offloader_include_local_changed``.
 *
 * Fires when the "include local in build pool" advanced toggle
 * flips through ``remote_build/set_offloader_settings``. Carries
 * the new value so subscribing tabs update their switch render
 * without re-fetching settings.
 */
export interface OffloaderIncludeLocalChangedEventData {
  include_local_in_pool: boolean;
}

/**
 * Data payload for ``receiver_peer_link_session_opened`` and
 * ``receiver_peer_link_session_closed``.
 *
 * Fires on the receiver-side bus whenever an APPROVED peer's
 * 5a-2 ``PeerLinkClient`` connects or disconnects. Drives the
 * ``PeerSummary.connected`` indicator: app-shell flips the
 * matching row's ``connected`` flag in the local
 * ``_buildServerPeers`` list. Both events share the same shape
 * (just the ``dashboard_id``); the discriminator is the event
 * type itself.
 */
export interface ReceiverPeerLinkSessionEventData {
  dashboard_id: string;
}

/**
 * Shared identity base for the peer-link session events
 * (OPENED / CLOSED).
 *
 * pin_sha256 is the canonical row key in the local
 * _buildOffloadPairings map; receiver coords are display fields
 * the renderer can use without a follow-up lookup (4a-o part 6).
 */
export interface OffloaderPeerLinkSessionEventData {
  receiver_hostname: string;
  receiver_port: number;
  pin_sha256: string;
}

/**
 * Data payload for offloader_peer_link_opened.
 *
 * The OPENED counterpart of the shared identity base, plus the
 * receiver's freshly-handshaked esphome_version. App-shell merges
 * it into the matching row keyed by pin_sha256 so a receiver
 * upgrade surfaces on the next reconnect without a page reload.
 * Empty until the first handshake fills it in.
 */
export interface OffloaderPeerLinkOpenedEventData extends OffloaderPeerLinkSessionEventData {
  esphome_version: string;
}

/**
 * Close-reason category for `OFFLOADER_PEER_LINK_CLOSED`.
 *
 * Mirrors the backend's union of receiver-driven
 * `TerminateReason` enum values (`superseded` /
 * `server_shutting_down` / `heartbeat_timeout` /
 * `malformed_frame` — the wire form of a structured `terminate`
 * frame) and the offloader-side reasons (`transport_error` /
 * `client_stopped` / `peer_hung_up` / `auth_rejected` /
 * `pin_mismatch` — what `PeerLinkClient` infers when our side
 * detects the close before the wire does). Two reasons in this
 * union are *orphan* close reasons where the run loop won't
 * reconnect: `superseded` and `pin_mismatch`. App-shell branches
 * on the literal — keeping it as a union (rather than `string`)
 * lets TypeScript catch typos before they land as silently-broken
 * UI state.
 */
export type PeerLinkCloseReason =
  | "superseded"
  | "server_shutting_down"
  | "heartbeat_timeout"
  | "malformed_frame"
  | "transport_error"
  | "client_stopped"
  | "peer_hung_up"
  | "auth_rejected"
  | "pin_mismatch";

/**
 * Data payload for offloader_peer_link_closed.
 *
 * Same identity fields as OffloaderPeerLinkSessionEventData
 * (the OPENED counterpart) plus the close-classification:
 *
 * - `reason`: category code, see `PeerLinkCloseReason`.
 * - `error_detail`: one-line human-readable description for
 *   the categories that have one (transport / Noise exception
 *   text, `"auth rejected"`, `"pin mismatch"`). Empty for
 *   clean closes where the category itself is the explanation
 *   (`client_stopped`, `superseded`, receiver-driven
 *   `terminate`).
 *
 * App-shell uses both fields to update the matching row's
 * `last_connect_error` (set to `error_detail`) and `connecting`
 * (true on non-orphan reasons; false on `pin_mismatch` /
 * `superseded` where the run loop won't retry).
 */
export interface OffloaderPeerLinkClosedEventData extends OffloaderPeerLinkSessionEventData {
  reason: PeerLinkCloseReason;
  error_detail: string;
}

/**
 * Data payload for offloader_job_state_changed.
 *
 * Fired on the offloader's bus per inbound job_state_changed
 * frame from the paired receiver this dashboard submitted
 * job_id to. status mirrors the wire literal exactly
 * (queued / running / completed / failed / cancelled);
 * error_message is empty on non-terminal states and on
 * completed, populated on failed / cancelled.
 *
 * Receiver coords + pin_sha256 are carried so subscribers
 * routing across multiple paired receivers can disambiguate;
 * the in-flight jobs map keys on job_id (which is unique per
 * peer-link session, so collisions across receivers don't
 * happen in practice).
 */
export interface OffloaderJobStateChangedEventData {
  receiver_hostname: string;
  receiver_port: number;
  pin_sha256: string;
  job_id: string;
  status: JobStatus;
  error_message: string;
}

/**
 * Data payload for offloader_job_output.
 *
 * Fired per inbound job_output frame. line preserves its
 * trailing terminator (\n / \r / \r\n) so the existing
 * ansi-log renderer's carriage-return-overwrite contract
 * works byte-identical to local JOB_OUTPUT events.
 *
 * High-rate path during an active build (one frame per line
 * of compiler / linker output). Subscribers should batch
 * downstream rendering rather than re-render per event.
 */
export interface OffloaderJobOutputEventData {
  receiver_hostname: string;
  receiver_port: number;
  pin_sha256: string;
  job_id: string;
  stream: JobStream;
  line: string;
}

/**
 * Data payload for the ``offloader_pair_pin_mismatch`` event.
 *
 * Fires alongside ``offloader_pair_status_changed
 * status="removed"`` when the offloader's pair-status
 * listener observes APPROVED + drifted pin (the receiver's
 * static X25519 pubkey hash differs from
 * ``StoredPairing.pin_sha256`` recorded at pair time). The
 * receiver's identity rotated under us. Carries the
 * diagnostic detail (``expected_pin`` / ``observed_pin``)
 * the status-changed event doesn't, plus the offloader-side
 * ``receiver_label`` so the alert can name the row even
 * after the pairings list has dropped it.
 *
 * No receiver-side counterpart event; the receiver never
 * sees its own pin drift, and the symmetric "offloader
 * rotated" case lands as a fresh PENDING row on the
 * receiver's inbox via
 * ``REMOTE_BUILD_PAIR_REQUEST_RECEIVED``.
 */
export interface OffloaderPairPinMismatchEventData {
  receiver_hostname: string;
  receiver_port: number;
  receiver_label: string;
  /**
   * The **stored** pin the row was keyed on (same value as
   * ``expected_pin``); duplicated as a separate field so a
   * pin-keyed lookup doesn't have to parse ``expected_pin``.
   * 4a-o part 6.
   */
  pin_sha256: string;
  expected_pin: string;
  observed_pin: string;
}

/**
 * Data payload for the ``offloader_pair_peer_revoked`` event.
 *
 * Fires alongside ``offloader_pair_status_changed
 * status="removed"`` when the offloader's pair-status
 * listener gets ``IntentResponse.REJECTED`` for a row the
 * offloader had as PENDING / APPROVED. From the offloader's
 * POV all four causes (admin Reject, window close, identity
 * rotation, row never existed) collapse to "the receiver
 * isn't going to talk to us"; the alert copy stays generic
 * ("the receiver removed us; reach out to that admin if it
 * was a mistake").
 *
 * The ``receiver_label`` is carried so the alert can name
 * the row even after the pairings list has dropped it.
 */
export interface OffloaderPairPeerRevokedEventData {
  receiver_hostname: string;
  receiver_port: number;
  receiver_label: string;
  /**
   * Stable cryptographic identifier the alert row keys on
   * (4a-o part 6).
   */
  pin_sha256: string;
}

/**
 * Data payload for the ``offloader_pair_alert_dismissed``
 * event.
 *
 * Fires when an entry leaves the controller's RAM-only
 * offloader-alerts dict via one of the two resolution paths:
 * a successful ``request_pair`` against the same
 * ``${hostname}:${port}`` (re-pair auto-resolved the alert),
 * or ``unpair`` removed the row outright. There is no
 * operator-driven dismiss — clicking "OK got it" without
 * acting would just hide a broken pairing the next peer-
 * link session would still fail against. Lets other tabs /
 * clients on the global ``subscribe_events`` stream sync
 * their local alerts list without re-fetching the snapshot.
 */
export interface OffloaderPairAlertDismissedEventData {
  receiver_hostname: string;
  receiver_port: number;
  /**
   * Stable cryptographic identifier the dismissed alert row
   * keyed on (4a-o part 6 — alerts dict re-keyed on pin).
   */
  pin_sha256: string;
}

/**
 * Snapshot row in the offloader-side alerts list (``pin_mismatch`` kind).
 *
 * Mirror of ``OffloaderPairPinMismatchEventData`` (the live
 * event) plus a ``kind`` discriminator so a single alerts
 * list can carry both pin-mismatch and peer-revoked entries
 * on the wire. Frontend subscribers branch on ``kind`` to
 * pick the alert copy + CTA.
 *
 * ``fired_at`` is the wall-clock unix timestamp the alert
 * was added to the dict. Snapshot order is dict insertion
 * order; frontends that want "newest first" sort on
 * ``fired_at`` themselves.
 */
export interface OffloaderPinMismatchAlert {
  kind: "pin_mismatch";
  receiver_hostname: string;
  receiver_port: number;
  /** Stable cryptographic identifier (4a-o part 6). */
  pin_sha256: string;
  receiver_label: string;
  expected_pin: string;
  observed_pin: string;
  fired_at: number;
}

/**
 * Snapshot row in the offloader-side alerts list (``peer_revoked`` kind).
 */
export interface OffloaderPeerRevokedAlert {
  kind: "peer_revoked";
  receiver_hostname: string;
  receiver_port: number;
  /** Stable cryptographic identifier (4a-o part 6). */
  pin_sha256: string;
  receiver_label: string;
  fired_at: number;
}

/**
 * Sum type the snapshot list carries. Each entry is one of
 * the two alert kinds above; the ``kind`` discriminator
 * narrows field access at the consumer.
 */
export type OffloaderAlertSnapshotEntry =
  OffloaderPinMismatchAlert | OffloaderPeerRevokedAlert;

/**
 * Data payload for the ``remote_build_identity_rotated`` event.
 *
 * Fires when the operator triggers ``rotate_identity``. Lets the
 * Settings UI refresh its cached pin without polling
 * ``get_identity`` (the dashboard might've been rotated from
 * another tab, or via the WS API directly). Only the rotated
 * fields are carried; ``server_version`` and
 * ``esphome_version`` don't change on rotation, and the
 * ``listener_bound`` state is best read via a fresh
 * ``get_identity`` call on the receiving tab.
 */
export interface RemoteBuildIdentityRotatedEventData {
  dashboard_id: string;
  pin_sha256: string;
}

/**
 * Data payload for ``REMOTE_BUILD_HOST_ADDED`` event.
 *
 * Aliases :type:`RemoteBuildPeer` directly (the backend fires
 * ``peer.to_dict()`` from ``_upsert_host``, identical to what
 * ``hosts_snapshot`` projects into
 * ``subscribe_events.initial_state.hosts``). Aliasing rather
 * than duplicating the field list keeps the event payload from
 * drifting out of shape when ``RemoteBuildPeer`` gains a field.
 * Fires from the controller's mDNS browse-callback cache-hit
 * branch and from the async resolve-success path. Upsert
 * semantics: subscribers key on ``name`` and replace an
 * existing row with the same key.
 */
export type RemoteBuildHostAddedEventData = RemoteBuildPeer;

/**
 * Data payload for ``REMOTE_BUILD_HOST_REMOVED`` event.
 *
 * Fires when zeroconf delivers a ``Removed`` callback (TTL
 * expiry without renewal, or an explicit goodbye). ``name``
 * matches the corresponding ``REMOTE_BUILD_HOST_ADDED`` event's
 * ``name`` field.
 */
export interface RemoteBuildHostRemovedEventData {
  name: string;
}
