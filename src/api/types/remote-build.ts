/**
 * Remote-build peers, pairing, identity and settings (issue #106).
 *
 * Part of the src/api/types.ts barrel split.
 */
import type { VersionMatchPolicy } from "./event-subscription.js";

// Remote-build feature (issue #106).
// Phase 2: peer dashboard discovery + receiver-side master switch.
// Phase 3c1: receiver dashboard identity + X25519 keypair rotation.
// Phase 4a: Noise XX peer-link replaces the bearer-token surface;
//           offloader-side pair flow + receiver-side pairing inbox.

/**
 * Origin of a discovered :class:`RemoteBuildPeer`. Collapsed to a
 * single ``"mdns"`` value after the manual-hosts surface was
 * deleted (the offloader-side pair flow accepts a typed hostname
 * + port directly without an intermediate "save" step). The
 * single-value union is kept rather than removed because the
 * backend's ``RemoteBuildPeer.source`` field still discriminates
 * for forward-compat (e.g. a future "configured" / "static"
 * source).
 */
export type RemoteBuildPeerSource = "mdns";

/**
 * Lifecycle position of a paired (or pending) peer / pairing.
 *
 * Mirrors the backend's ``PeerStatus`` StrEnum. ``pending`` rows
 * land via the pair_request flow and live in-memory only on the
 * receiver (admin hasn't accepted yet); ``approved`` rows are
 * persisted and grant full peer-link access. There is no
 * explicit ``rejected`` terminal state — Reject deletes the row.
 */
export type PeerStatus = "pending" | "approved";

/**
 * Receiver-side wire view of a paired offloader (``StoredPeer``).
 *
 * Drops the raw 32-byte X25519 pubkey; ``pin_sha256`` is the
 * wire-friendly form (lowercase-hex SHA-256 of the pubkey)
 * that UIs render for OOB-verification. ``status`` is supplied
 * by the controller because the receiver-side ``StoredPeer``
 * itself doesn't carry one (PENDING peers live in the
 * controller's in-memory dict; persisted peers are implicitly
 * APPROVED). ``peer_ip`` is the source IP observed at
 * pair_request time and persisted on ``StoredPeer``; the
 * receiver Settings inbox renders it next to the pin so the
 * operator can clone-risk-sanity-check the source against
 * expectations. Empty string for legacy on-disk rows from
 * receivers that pre-date the persisted ``peer_ip`` field —
 * the renderer hides the row line in that case.
 */
export interface PeerSummary {
  dashboard_id: string;
  pin_sha256: string;
  label: string;
  paired_at: number;
  status: PeerStatus;
  peer_ip: string;
  /**
   * Whether the receiver currently has an active 5a-2 peer-link
   * session for this peer (``dashboard_id`` membership in the
   * receiver's ``_peer_link_sessions`` registry). Legacy
   * backends that pre-date the field may omit it; in that case,
   * the renderer treats the missing value as falsy and shows
   * "Disconnected" rather than crashing.
   *
   * Live updates flow through
   * ``RECEIVER_PEER_LINK_SESSION_OPENED`` /
   * ``RECEIVER_PEER_LINK_SESSION_CLOSED`` bus events on the
   * ``subscribe_events`` stream; the snapshot
   * (``initial_state.peers``) carries the current value at
   * subscribe time so a reconnecting tab paints the right
   * state without waiting for the next event.
   *
   * Always ``false`` for PENDING rows: peer-link is gated on
   * APPROVED status server-side via ``lookup_peer_for_session``,
   * so a PENDING peer can never legitimately have a registered
   * session.
   */
  connected: boolean;
}

/**
 * Offloader-side wire view of a pinned receiver
 * (``StoredPairing``).
 *
 * Mirror of ``PeerSummary`` for the offloader side: drops the
 * raw X25519 pubkey, keys on the receiver coordinates the user
 * entered (rather than the receiver's ``dashboard_id``, which
 * the offloader doesn't track). ``status`` reflects the
 * row's lifecycle in the unified ``_pairings`` dict on the
 * controller; the disk filter strips PENDING rows at serialise
 * time so APPROVED is the on-disk shape.
 */
export interface PairingSummary {
  receiver_hostname: string;
  receiver_port: number;
  pin_sha256: string;
  label: string;
  paired_at: number;
  status: PeerStatus;
  /**
   * Whether the offloader currently has an open 5a-2 peer-link
   * session to the receiver (pin_sha256 membership in the
   * controller's _open_peer_links set). Live updates flow
   * through OFFLOADER_PEER_LINK_OPENED /
   * OFFLOADER_PEER_LINK_CLOSED bus events on the
   * subscribe_events stream; the snapshot
   * (initial_state.pairings) carries the current value at
   * subscribe time so a reconnecting tab paints the right state
   * without waiting for the next event.
   *
   * Always false for PENDING rows: the offloader doesn't spawn
   * a peer-link client until the receiver flips the row to
   * APPROVED.
   */
  connected: boolean;
  /**
   * Whether the offloader's per-pairing peer-link client task
   * is alive but has no open session right now. Covers the
   * very first connect attempt and every subsequent reconnect
   * cycle inside the run loop's backoff window. Goes false on
   * `connected` (post-handshake open) and on the orphan paths
   * (pin mismatch / superseded) where the run loop won't retry
   * — operator's recovery there is re-pair / unpair, not
   * "wait for reconnect," so both `connected` and `connecting`
   * report false on those states.
   *
   * UI uses the tri-state to render Connected / Connecting… /
   * Disconnected; pair an empty `last_connect_error` with
   * `connecting=true` and the row is the steady-state
   * reconnect cycle, while a non-empty error there + both
   * flags false is the orphaned terminal case.
   */
  connecting: boolean;
  /**
   * One-line description of the most recent connection failure
   * (`"<ExceptionType>: <message>"` for transport / Noise
   * errors, `"auth rejected"`, `"pin mismatch"`). Cleared when
   * a session reaches the post-handshake open state so a
   * stale message can't outlive a successful reconnect.
   *
   * Live updates ride on `OFFLOADER_PEER_LINK_CLOSED.error_detail`;
   * the snapshot here is the post-load value for tabs that
   * subscribe after an in-flight failure.
   */
  last_connect_error: string;
  /**
   * Receiver-advertised `esphome.const.__version__` captured
   * at handshake time and refreshed on every peer-link
   * session-open. Empty string before the first successful
   * handshake (PENDING row, or APPROVED row that has never
   * connected). Used by Settings → Build server → paired
   * build servers to surface a per-row version-mismatch
   * sub-line ahead of the scheduler's
   * allow-major-version-mismatch toggle landing in 7a-3 +
   * 7b. Both sides are wire-typed `string`; comparison is
   * structural (year+month vs patch) per
   * `util/version-mismatch.ts`.
   */
  esphome_version: string;
  /**
   * Whether this pairing is eligible for the transparent
   * install flow's auto-route to remote build (7b). When
   * `false`, the backend's `pick_build_path` walks past
   * this row and looks for the next eligible APPROVED +
   * connected + idle pairing; if none exist the install
   * falls back to LOCAL. The peer-link session stays open
   * regardless and the Send-builds power-user dialog still
   * works against this receiver — only the implicit
   * auto-route is gated. Live updates flow through
   * `OFFLOADER_PAIRING_ENABLED_CHANGED` events.
   *
   * Defaults to `true` for back-compat with pre-7b
   * sidecars (any APPROVED + connected + idle pairing was
   * eligible).
   */
  enabled: boolean;
}

/**
 * Receiver-side pairing-window state.
 *
 * Returned from ``remote_build/set_pairing_window`` and
 * delivered as the ``remote_build_pairing_window_changed``
 * event payload. The window narrows when ``intent="pair_request"``
 * Noise frames are accepted: only while the receiver's Pairing
 * requests screen is mounted. ``expires_in_seconds`` is
 * ``null`` when ``open`` is ``false``; otherwise it's the
 * remaining lifetime against the latest activity-driven extend
 * (frontend renders the live countdown from this value and ticks
 * locally between events).
 */
export interface PairingWindowState {
  open: boolean;
  expires_in_seconds: number | null;
}

/**
 * Wire view returned from ``remote_build/get_offloader_settings``
 * and ``remote_build/set_offloader_settings`` (7b).
 *
 * Bundles the master ``remote_builds_enabled`` toggle with the
 * pairings list so the offloader Settings UI's first paint
 * reads everything it needs from one round-trip. Subsequent
 * live updates flow through ``OFFLOADER_REMOTE_BUILDS_TOGGLED``
 * / ``OFFLOADER_PAIRING_ENABLED_CHANGED`` /
 * ``OFFLOADER_PAIR_STATUS_CHANGED`` events on the global
 * ``subscribe_events`` stream.
 */
export interface OffloaderRemoteBuildSettings {
  remote_builds_enabled: boolean;
  /**
   * Master version-match policy; see :type:`VersionMatchPolicy`
   * for the per-value semantics.
   */
  version_match_policy: VersionMatchPolicy;
  /**
   * Advanced: include the local machine in the build pool so it
   * compiles overflow when every paired build server is busy.
   * Off by default.
   */
  include_local_in_pool: boolean;
  pairings: PairingSummary[];
}

export interface RemoteBuildSettings {
  enabled: boolean;
  /**
   * 6c cleanup-sweep cold-subtree threshold (seconds). Backend
   * defaults to 24h and clamps writes to [1h, 30d] via the
   * `remote_build/set_settings` validator. The UI renders this
   * as hours; the conversion lives at the input boundary so
   * the wire shape stays a single primitive.
   */
  cleanup_ttl_seconds: number;
  /** Receiver-side pinned offloaders. Includes both PENDING (in
   *  the receiver's ``_pending_peers`` dict) and APPROVED
   *  (persisted) rows, projected through ``PeerSummary``. */
  peers: PeerSummary[];
}

/**
 * Bounds for {@link RemoteBuildSettings.cleanup_ttl_seconds}.
 * Mirror the backend's `MIN_CLEANUP_TTL_SECONDS` /
 * `MAX_CLEANUP_TTL_SECONDS` constants so the UI input clamps to
 * the same range and the operator gets a client-side validation
 * hint before the WS round-trip.
 */
export const CLEANUP_TTL_MIN_SECONDS = 60 * 60;
export const CLEANUP_TTL_MAX_SECONDS = 30 * 24 * 60 * 60;
export const CLEANUP_TTL_DEFAULT_SECONDS = 24 * 60 * 60;

export interface RemoteBuildPeer {
  name: string;
  hostname: string;
  port: number;
  source: RemoteBuildPeerSource;
  addresses: string[];
  server_version: string;
  esphome_version: string;
  /**
   * Human machine label from the mDNS TXT `friendly_name` key, used as
   * the display label. Empty for older receivers that don't broadcast
   * it; callers fall back to `name`.
   */
  friendly_name: string;
  /**
   * SHA-256 of the receiver's static X25519 peer-link pubkey,
   * lowercase hex, parsed off the mDNS TXT record. Empty string
   * for receivers that haven't bound the peer-link listener at
   * announce time (default-off mode). The offloader's mDNS
   * auto-rebind path matches this against persisted pairings;
   * the discovered-row Pair button doesn't read it (the wizard
   * runs `preview_pair` against the chosen endpoint and OOBs
   * the live fingerprint).
   */
  pin_sha256: string;
  /**
   * Receiver's peer-link Noise WS port from the TXT
   * `remote_build_port` key, NOT the SRV dashboard HTTP `port` above.
   * `0` when no peer-link listener is bound (default-off, e.g. HA addon),
   * i.e. the host can't accept builds. The Send Builds → Known Dashboards
   * list filters those out; the Pair button there pre-fills a `> 0` port.
   */
  remote_build_port: number;
}

/**
 * Receiver's stable identity, returned from
 * 'remote_build/get_identity' and 'remote_build/rotate_identity'.
 *
 * The X25519 private key is intentionally NOT included -- only
 * the public-key fingerprint ('pin_sha256', lowercase-hex
 * SHA-256 of the X25519 public key) is safe to ship, and it's
 * what a peer pins against during the Noise XX handshake.
 * 'listener_bound' reports whether the peer-link Noise WS is
 * currently serving traffic; lets the Settings UI distinguish
 * "rotation succeeded AND the listener is back up" from
 * "rotation succeeded but the rebuild fail-softed; check
 * logs".
 */
export interface IdentityView {
  dashboard_id: string;
  pin_sha256: string;
  server_version: string;
  esphome_version: string;
  listener_bound: boolean;
}
