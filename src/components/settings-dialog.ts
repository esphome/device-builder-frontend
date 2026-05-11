import { consume } from "@lit/context";
import {
  mdiClose,
  mdiHandshakeOutline,
  mdiPaletteOutline,
  mdiPencil,
  mdiSendOutline,
  mdiServerNetwork,
  mdiTranslate,
  mdiVectorDifference,
} from "@mdi/js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import toast from "sonner-js";
import { APIError } from "../api/api-error.js";
import type { ESPHomeAPI } from "../api/esphome-api.js";
import {
  CLEANUP_TTL_DEFAULT_SECONDS,
  CLEANUP_TTL_MAX_SECONDS,
  CLEANUP_TTL_MIN_SECONDS,
  ErrorCode,
  type IdentityView,
  type OffloaderAlertSnapshotEntry,
  type PairingSummary,
  type PairingWindowState,
  type PeerSummary,
  type RemoteBuildPeer,
} from "../api/types.js";
import type { LocalizeFunc, SupportedLocale } from "../common/localize.js";
import { readStoredLocale } from "../common/localize.js";

/** Sentinel meaning "follow browser locale" (no explicit override). */
type LanguageChoice = SupportedLocale | "system";
import {
  apiContext,
  buildOffloadDiscoveredHostsContext,
  buildOffloadAlertsContext,
  buildOffloadJobsContext,
  buildOffloadPairingsContext,
  offloaderRemoteBuildsEnabledContext,
  buildServerIdentityRotationCounterContext,
  buildServerPairingWindowStateContext,
  buildServerPeersContext,
  localizeContext,
  remoteBuildCleanupTtlContext,
  remoteBuildEnabledContext,
  versionContext,
  yamlDiffButtonContext,
} from "../context/index.js";
import type { RemoteBuildJobState } from "../context/index.js";
import { pinHexStyles } from "../styles/pin-hex.js";
import { espHomeStyles } from "../styles/shared.js";
import { formatPinSha256 } from "../util/pin-format.js";
import { copyToClipboard } from "../util/copy-to-clipboard.js";
import {
  normalizeHostnameForCompare,
  trimTrailingDot,
} from "../util/hostname.js";
import { registerMdiIcons } from "../util/register-icons.js";
import { remainingOf } from "../util/relative-time.js";
import { classifyVersionMismatch } from "../util/version-mismatch.js";
import "./accept-peer-dialog.js";
import type { ESPHomeAcceptPeerDialog } from "./accept-peer-dialog.js";
import "./confirm-dialog.js";
import type { ESPHomeConfirmDialog } from "./confirm-dialog.js";
import "./edit-pairing-endpoint-dialog.js";
import type { ESPHomeEditPairingEndpointDialog } from "./edit-pairing-endpoint-dialog.js";
import "./pair-build-server-dialog.js";
import "./pin-emoji-grid.js";
import "./reauth-wizard-dialog.js";
import "./remote-build-job-dialog.js";
import type { ESPHomePairBuildServerDialog } from "./pair-build-server-dialog.js";
import type { ESPHomeReauthWizardDialog } from "./reauth-wizard-dialog.js";
import type { ESPHomeRemoteBuildJobDialog } from "./remote-build-job-dialog.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/option/option.js";
import "@home-assistant/webawesome/dist/components/select/select.js";
import "./base-dialog.js";

registerMdiIcons({
  close: mdiClose,
  "handshake-outline": mdiHandshakeOutline,
  "palette-outline": mdiPaletteOutline,
  pencil: mdiPencil,
  "send-outline": mdiSendOutline,
  "server-network": mdiServerNetwork,
  translate: mdiTranslate,
  "vector-difference": mdiVectorDifference,
});

// "Remote builder" used to be one section with two roles
// presented as subheadings (Receive / Offload). Split into
// two sidebar entries because the two roles share no state
// (different WS commands, different mental model —
// operators rarely do both) and the Receive half is growing
// fast (master toggle + build-server identity card + tokens
// list + binding-mismatch alerts in 3c2c+). Each operator
// typically uses one or the other, not both, so collapsing
// into two distinct destinations matches how they think
// about the feature.
//
// Translation-key namespace convention after the split:
//
//   ``settings.remote_build_*``  — feature-level strings
//                                  whose meaning is the same
//                                  regardless of which
//                                  section they live in
//                                  (e.g. ``remote_build_pin_label``,
//                                  ``remote_build_enable``,
//                                  ``remote_build_known_dashboards``).
//                                  Renaming these would be
//                                  churn-without-payoff;
//                                  they describe the
//                                  remote-build feature, not
//                                  the section's UI.
//   ``settings.build_server_*``  — UI strings for the Build
//                                  server section's specific
//                                  layout (sidebar label,
//                                  card heading, etc.).
//   ``settings.build_offload_*`` — same shape on the
//                                  offload side.
type Section =
  | "appearance"
  | "language"
  | "editor"
  | "build_server"
  | "pairing_requests"
  | "build_offload";

interface SectionDef {
  id: Section;
  icon: string;
  labelKey: string;
  // Optional group tag. Sections that share a non-empty group
  // are rendered together in the nav under a small uppercase
  // group header (currently used only for 'experimental').
  // Sections with no group are rendered first as a flat list.
  group?: "experimental";
}

const SECTIONS: SectionDef[] = [
  { id: "appearance", icon: "palette-outline", labelKey: "settings.appearance" },
  { id: "language", icon: "translate", labelKey: "settings.language" },
  { id: "editor", icon: "vector-difference", labelKey: "layout.editor" },
  {
    // "Build server" = Receive role: this dashboard offering
    // its CPU to other dashboards on the network. We use
    // "build server" rather than "build host" because the
    // CI/CD term is broadly recognised; "build host" reads
    // as jargon for users who haven't seen it before.
    // Grouped under the EXPERIMENTAL nav header alongside its
    // sibling Pairing requests + Send builds entries: the
    // remote-build flow as a whole is still in development
    // (the receiver site binds and accepts pair requests, but
    // the operator-facing UX, pair-approval modal, scheduler,
    // and the offloader's submit_job pipeline are landing
    // across multiple phases).
    id: "build_server",
    icon: "server-network",
    labelKey: "settings.build_server",
    group: "experimental",
  },
  {
    // "Pairing requests" is its own sidebar entry rather than a
    // subsection inside Build server because the pairing
    // window's open/closed state is bound to the operator
    // viewing this specific screen. Folding it under Build
    // server made the door silently open whenever an admin
    // poked around the identity fingerprint, which was the
    // wrong default for a security-sensitive accept gate.
    // Senders' "ask the receiver to open Settings → Pairing
    // requests" copy is now an accurate navigation prompt
    // because the path it names exists as a discrete screen.
    // Marked experimental alongside Build server / Send builds
    // because the pair-approval surface is still maturing.
    id: "pairing_requests",
    icon: "handshake-outline",
    labelKey: "settings.pairing_requests",
    group: "experimental",
  },
  {
    // "Send builds" = Offload role: this dashboard
    // dispatching its compiles to another dashboard. The
    // offload direction is the least-finished of the three
    // remote-build screens: the typed hostnames +
    // paired-build-server rows here are remembered, but no
    // compile job is actually dispatched until the
    // offloader's submit_job pipeline lands.
    id: "build_offload",
    icon: "send-outline",
    labelKey: "settings.build_offload",
    group: "experimental",
  },
];

const LANGUAGES: { value: LanguageChoice; labelKey: string }[] = [
  { value: "system", labelKey: "settings.language_system" },
  { value: "en", labelKey: "settings.language_en" },
  { value: "fr", labelKey: "settings.language_fr" },
  { value: "nl", labelKey: "settings.language_nl" },
];

@customElement("esphome-settings-dialog")
export class ESPHomeSettingsDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: yamlDiffButtonContext, subscribe: true })
  @state()
  private _yamlDiffButton = false;

  @consume({ context: remoteBuildEnabledContext, subscribe: true })
  @state()
  private _remoteBuildEnabled = false;

  // 6c cleanup-sweep TTL in seconds. App-shell loads this off
  // ``remote_build/get_settings`` and provides it via the
  // context; the input row below renders it as hours and
  // fires ``set-remote-build-cleanup-ttl`` (in seconds) on
  // commit, which app-shell rewrites through
  // ``setRemoteBuildSettings``.
  @consume({ context: remoteBuildCleanupTtlContext, subscribe: true })
  @state()
  private _remoteBuildCleanupTtl = CLEANUP_TTL_DEFAULT_SECONDS;

  // Local dashboard's bundled ESPHome version. Compared
  // against each paired build server's
  // ``PairingSummary.esphome_version`` to drive the
  // per-row mismatch sub-line in the paired-build-servers
  // list. App-shell publishes this via ``versionContext``
  // once the ServerInfo handshake completes; subscribers
  // also pick up the value if it changes (rotate / restart
  // path through the same context). Empty string before
  // ServerInfo lands — the helper treats empty as "unknown,
  // don't surface a mismatch."
  @consume({ context: versionContext, subscribe: true })
  @state()
  private _appVersion = "";

  @consume({
    context: buildServerIdentityRotationCounterContext,
    subscribe: true,
  })
  @state()
  private _buildServerIdentityRotationCounter = 0;

  @consume({ context: apiContext })
  private _api?: ESPHomeAPI;

  // mDNS-discovered offload-target dashboards. App-shell
  // maintains the canonical map (seeded from
  // ``initial_state.hosts`` + mutated on
  // ``REMOTE_BUILD_HOST_ADDED`` / ``REMOTE_BUILD_HOST_REMOVED``
  // events); the Send builds section consumes it directly. The
  // shape is keyed on the mDNS service-instance ``name`` so
  // re-announces / TXT refreshes overwrite cleanly. Render order
  // is determined at render time (insertion order from the map);
  // a future "alphabetical" toggle would sort there. ``null``
  // until the snapshot lands so the UI can distinguish "no
  // controller" from "loaded with zero rows".
  @consume({ context: buildOffloadDiscoveredHostsContext, subscribe: true })
  @state()
  private _buildOffloadDiscoveredHosts: Map<string, RemoteBuildPeer> | null =
    null;

  // Offloader-side pairings (PENDING + APPROVED). App-shell
  // maintains the canonical map (seeded from
  // ``initial_state.pairings`` + mutated on
  // ``OFFLOADER_PAIR_STATUS_CHANGED``); the Send-builds section
  // renders one row per entry under "Paired build servers".
  // Keyed on ``${hostname}:${port}`` to match the backend's
  // ``StoredPairing``. ``null`` until the snapshot lands so
  // the UI can distinguish "no controller" from "loaded with
  // zero rows".
  @consume({ context: buildOffloadPairingsContext, subscribe: true })
  @state()
  private _buildOffloadPairings: Map<string, PairingSummary> | null = null;

  // 7b — offloader-side master "Remote builds enabled" toggle.
  // App-shell seeds this from
  // ``initial_state.remote_builds_enabled`` and updates on
  // ``OFFLOADER_REMOTE_BUILDS_TOGGLED`` events; the Send-builds
  // section renders a toggle row at the top wired through
  // ``set-offloader-remote-builds-enabled`` to app-shell's
  // ``setOffloaderRemoteBuildSettings`` write. ``null`` until
  // the snapshot lands so the switch row can render disabled
  // (avoids paint-time flips between default-true and the
  // landed value).
  @consume({ context: offloaderRemoteBuildsEnabledContext, subscribe: true })
  @state()
  private _offloaderRemoteBuildsEnabled: boolean | null = null;

  // Offloader-side pair alerts (pin_mismatch / peer_revoked).
  // App-shell maintains the canonical map (seeded from
  // ``initial_state.offloader_alerts`` + mutated on the three
  // alert events); the Send-builds section renders one alert
  // banner per entry above the paired-build-servers list.
  // Keyed on ``${hostname}:${port}`` like the pairings map.
  // Alerts only clear via re-pair or unpair; no operator
  // dismiss CTA — clicking "OK got it" without acting would
  // hide a broken pairing the next peer-link session would
  // still fail against.
  @consume({ context: buildOffloadAlertsContext, subscribe: true })
  @state()
  private _buildOffloadAlerts: Map<string, OffloaderAlertSnapshotEntry> | null =
    null;

  // In-flight + recently-terminal remote-build jobs the user
  // dispatched, keyed on job_id. Used by the per-pairing-row
  // "View build" affordance to re-open the dispatch dialog
  // on a previously-submitted job's progress view (the row
  // surfaces the most-recent entry for its pin). Driven by
  // OFFLOADER_JOB_STATE_CHANGED / OFFLOADER_JOB_OUTPUT events
  // through app-shell. null until app-shell mounts (always
  // immediate today; the null-vs-empty distinction follows
  // the same shape sibling contexts use).
  @consume({ context: buildOffloadJobsContext, subscribe: true })
  @state()
  private _buildOffloadJobs: Map<string, RemoteBuildJobState> | null = null;

  // Pending Unpair confirmation. Identified by ``pin_sha256``
  // (the wire-canonical row id sent to ``unpairRemoteBuild``);
  // ``hostname`` / ``port`` / ``label`` are retained for display
  // in the destructive-confirm dialog only. ``null`` when no
  // Unpair is pending.
  @state()
  private _pendingUnpair: {
    pin_sha256: string;
    hostname: string;
    port: number;
    label: string;
  } | null = null;

  // Receiver identity (identity fingerprint + listener-bound + versions).
  // Lazy-loaded the first time the user opens the section,
  // refreshed after a successful rotate. ``null`` means
  // "not yet loaded"; an explicit error state is tracked
  // separately so the UI can render a "couldn't load — try
  // re-opening Settings" message rather than spinning forever.
  @state()
  private _buildServerIdentity: IdentityView | null = null;

  @state()
  private _buildServerIdentityLoadFailed = false;

  // Gates concurrent rotate clicks so a double-click can't
  // fire two ``rotate_identity`` requests. The backend itself
  // rejects the second with ``ALREADY_EXISTS`` (3c1's
  // single-flight contract), but disabling the button is the
  // user-facing equivalent.
  @state()
  private _buildServerRotateInFlight = false;

  // Phase 4b-2: receiver-side peer list (PENDING + APPROVED).
  // App-shell maintains the canonical list — seeded from
  // ``initial_state.peers`` at subscribe time, mutated locally on
  // each ``REMOTE_BUILD_PAIR_REQUEST_RECEIVED`` (upsert) /
  // ``REMOTE_BUILD_PAIR_STATUS_CHANGED`` (status flip / row
  // drop) event. Settings dialog consumes via context; no
  // separate fetch path.
  @consume({ context: buildServerPeersContext, subscribe: true })
  @state()
  private _buildServerPeers: PeerSummary[] | null = null;

  /**
   * Pending Remove of an APPROVED peer — captured when the user
   * clicks Remove on a paired-sender row, drained by the shared
   * ``<esphome-confirm-dialog>``'s ``@confirm`` handler. PENDING
   * peers' Reject path lives in the dedicated
   * ``<esphome-accept-peer-dialog>`` and bypasses this state.
   * ``null`` when no Remove is pending.
   */
  @state()
  private _pendingPeerRemove: { dashboardId: string } | null = null;

  // Latest pairing-window state (open / closed / remaining
  // lifetime). ``null`` until the first event lands or the
  // section's ``setRemoteBuildPairingWindow`` opens it.
  @consume({ context: buildServerPairingWindowStateContext, subscribe: true })
  @state()
  private _buildServerPairingWindowState: PairingWindowState | null = null;

  /**
   * Pairing-window countdown bookkeeping, mirroring the
   * "anchor + baseline + tick" shape that
   * ``firmware-jobs-dialog`` and the device drawer's
   * Reachability section already use for live relative-time
   * displays.
   *
   * - ``_pairingBaselineSeconds`` is the most-recent
   *   ``expires_in_seconds`` from the
   *   ``remote_build_pairing_window_changed`` event (or ``null``
   *   when the window is closed / hasn't been opened yet).
   * - ``_pairingAnchorMs`` is the wall-clock at which we
   *   captured that baseline; the live countdown is derived as
   *   ``remainingOf(baseline, anchor, Date.now())`` at render
   *   time so we don't trust frontend / backend clocks to be in
   *   sync.
   * - ``_pairingTick`` is bumped 1Hz by ``_pairingTickHandle``
   *   purely to nudge Lit into a re-render; the value itself is
   *   unused. Same idiom as ``device-drawer-content._tick``.
   */
  @state()
  private _pairingBaselineSeconds: number | null = null;

  private _pairingAnchorMs = 0;

  @state()
  private _pairingTick = 0;

  private _pairingTickHandle: ReturnType<typeof setInterval> | null = null;

  @query("#rotate-confirm")
  private _rotateConfirmDialog!: ESPHomeConfirmDialog;

  @query("#peer-remove-confirm")
  private _peerRemoveConfirmDialog!: ESPHomeConfirmDialog;

  @query("esphome-accept-peer-dialog")
  private _acceptPeerDialog!: ESPHomeAcceptPeerDialog;

  @query("esphome-pair-build-server-dialog")
  private _pairBuildServerDialog!: ESPHomePairBuildServerDialog;

  @query("esphome-reauth-wizard-dialog")
  private _reauthWizardDialog!: ESPHomeReauthWizardDialog;

  @query("esphome-edit-pairing-endpoint-dialog")
  private _editPairingEndpointDialog!: ESPHomeEditPairingEndpointDialog;

  @query("esphome-remote-build-job-dialog")
  private _remoteBuildDialog!: ESPHomeRemoteBuildJobDialog;

  @query("#unpair-confirm")
  private _unpairConfirmDialog!: ESPHomeConfirmDialog;

  @state()
  private _section: Section = "appearance";

  @state()
  private _theme: string = localStorage.getItem("esphome-theme") ?? "system";

  @state()
  private _language: LanguageChoice = readStoredLocale() ?? "system";

  @state()
  private _open = false;

  open() {
    this._theme = localStorage.getItem("esphome-theme") ?? "system";
    this._language = readStoredLocale() ?? "system";
    this._section = "appearance";
    // Drop any stale identity from a previous open so the user
    // sees the loading state on each fresh dialog visit.
    // Identity can change between opens (operator rotated the
    // cert from another tab); the rotate flow refreshes
    // locally, so a stale value here would look correct without
    // actually being live. Discovered hosts come from app-shell
    // via context; nothing to reset.
    this._buildServerIdentity = null;
    this._buildServerIdentityLoadFailed = false;
    // Reset rotate-in-flight too — the user could have closed
    // the dialog mid-rotate (or while the confirm modal was
    // open), and a stale ``true`` would leave the Rotate
    // button disabled on the next visit. The shared
    // ``<esphome-confirm-dialog>`` handles its own state, so
    // we only reset the flag here.
    this._buildServerRotateInFlight = false;
    // ``_buildServerPeers`` is provided by app-shell via
    // context; nothing to reset here. The pending-remove key
    // does need clearing — a stale value would mis-target the
    // confirm dialog on the next visit.
    this._pendingPeerRemove = null;
    this._open = true;
  }

  close() {
    // ``<esphome-base-dialog>`` re-emits ``after-hide`` for
    // every dismissal path (close button, Esc, light-dismiss
    // outside-click), so the cleanup lives in
    // ``_onDialogAfterHide`` to make sure it runs regardless
    // of how the dialog closed. Programmatic close still
    // flows through here.
    this._open = false;
  }

  /**
   * Flip our local ``_open`` flag the moment the user
   * initiates a close (X / Esc / outside-click), before
   * wa-dialog finishes its hide animation. Without this,
   * the 1Hz ``_pairingTick`` interval can fire a re-render
   * mid-hide while ``_open`` is still ``true``, which
   * re-asserts ``?open=true`` on the inner wa-dialog and
   * cancels the in-progress hide. Doesn't ``preventDefault``
   * — we don't have a host-side veto reason — so the close
   * still proceeds and ``_onDialogAfterHide`` fires for the
   * server-side window cleanup.
   */
  private _onDialogRequestClose = (): void => {
    this._open = false;
  };

  disconnectedCallback() {
    // Drop any in-flight tick interval so a remove-from-DOM (HMR,
    // navigation away from the dashboard) doesn't leak it. The
    // server-side pairing window is left to its idle timer; this
    // path doesn't have a place to await the close call.
    this._stopPairingTick();
    super.disconnectedCallback();
  }

  /**
   * Always-runs cleanup for any dismissal path (close button,
   * Esc, outside-click).
   *
   * Two side effects: stop the local countdown ticker, and tell
   * the server the operator has left the screen so the
   * receiver-side pairing window can drop our client from its
   * refcount immediately. Fire-and-forget on the WS call; the
   * receiver's idle timer is the safety net.
   */
  private _onDialogAfterHide = () => {
    // wa-dialog finished its hide sequence (after Esc /
    // outside-click / X). Flip our local open flag so the
    // next render's ``?open`` binding matches.
    this._open = false;
    this._stopPairingTick();
    if (this._section === "pairing_requests" && this._api !== undefined) {
      void this._api
        .setRemoteBuildPairingWindow({ open: false })
        .catch(() => {
          // Ignore: dialog is closing; if the call failed the
          // receiver's idle timer cleans up.
        });
    }
  };

  /**
   * Cross-tab refresh hook for the receiver identity.
   *
   * ``_buildServerIdentityRotationCounter`` increments via the
   * matching context whenever app-shell receives a
   * ``remote_build_identity_rotated`` event. On change, re-fetch
   * the identity so this tab's card matches whatever the
   * rotating tab landed on disk. Two cases:
   *
   * - User is currently on the Build server section: refetch
   *   immediately so the visible card shows fresh data.
   * - User is on a different section: null the cached value so
   *   the lazy-load in ``_selectSection`` fires a fresh load
   *   when they navigate back.
   *
   * ``changed.get(...)`` returns the *previous* value, which is
   * ``undefined`` on the very first sync (Lit's first callback
   * after the consumer connects to the provider). Skip that one
   * — it's the initial value flowing through, not a real event.
   */
  protected updated(changed: Map<string, unknown>) {
    super.updated(changed);
    if (changed.has("_buildServerIdentityRotationCounter")) {
      const prev = changed.get("_buildServerIdentityRotationCounter");
      if (prev !== undefined) {
        if (this._section === "build_server") {
          void this._loadBuildServerIdentity();
        } else {
          this._buildServerIdentity = null;
          this._buildServerIdentityLoadFailed = false;
        }
      }
    }
    // Receiver-side peer list flows in via app-shell's context
    // directly; no refetch hook needed here.
    if (changed.has("_buildServerPairingWindowState")) {
      // Re-seed the local countdown anchor from the
      // freshly-pushed window state. ``expires_in_seconds`` is
      // null when the window is closed (or hasn't been opened
      // yet); in that case the baseline clears and the local
      // ticker stops.
      //
      // Guard the start branch on "the operator is actually
      // viewing the Pairing requests screen right now" so a
      // cross-tab event flowing in while Settings is closed (or
      // showing a different section) doesn't leak a 1Hz
      // ``setInterval`` against a countdown nobody can see.
      // ``_selectSection`` re-runs this check on entry by
      // re-issuing ``setRemoteBuildPairingWindow({open: true})``,
      // which fires a fresh event and lands us back here with
      // the gates satisfied.
      const state = this._buildServerPairingWindowState;
      if (
        state?.open &&
        state.expires_in_seconds !== null &&
        this._section === "pairing_requests" &&
        this._open
      ) {
        this._pairingBaselineSeconds = state.expires_in_seconds;
        this._pairingAnchorMs = Date.now();
        this._startPairingTick();
      } else {
        this._pairingBaselineSeconds = null;
        this._stopPairingTick();
      }
    }
  }

  private _selectSection(section: Section) {
    const previousSection = this._section;
    this._section = section;
    // Leaving Pairing requests: close the pairing window we
    // opened on entry (refcounted server-side; a graceful close
    // drops our client immediately rather than waiting on the
    // 5min idle timer). The window's open/closed state is bound
    // to the operator viewing this specific screen so the door
    // tracks the operator's attention rather than silently
    // staying open while they wander other Settings sections.
    // Fire-and-forget; the receiver's idle cleanup is the
    // safety net.
    if (
      previousSection === "pairing_requests" &&
      section !== "pairing_requests"
    ) {
      // Stop the local countdown immediately on section change;
      // the close event from the backend will follow shortly,
      // but we don't want to keep ticking against a window the
      // operator has already navigated away from.
      this._stopPairingTick();
      this._pairingBaselineSeconds = null;
      if (this._api !== undefined) {
        void this._api
          .setRemoteBuildPairingWindow({ open: false })
          .catch(() => {
            // Ignore: section change shouldn't block on a window
            // close failure; idle timer cleans up.
          });
      }
    }
    // Each role lazy-loads only the receiver-identity card on
    // section enter; discovered hosts and receiver-side peers
    // are pushed via context (seeded from
    // ``subscribe_events`` initial-state, mutated on events) so
    // there's no per-section refetch. Both sections may be
    // visited in the same dialog open without re-hitting the
    // backend.
    if (section === "build_server") {
      if (this._buildServerIdentity === null && !this._buildServerIdentityLoadFailed) {
        void this._loadBuildServerIdentity();
      }
    }
    if (section === "pairing_requests" && this._api !== undefined) {
      // Open the pairing window so ``intent="pair_request"``
      // Noise frames are accepted while the admin is on this
      // screen. Refcounted server-side; the receiver auto-closes
      // 5min after the most recent open/extend tick from any
      // client. The frontend doesn't periodically extend in this
      // PR — typical accept/reject sessions are well under 5min;
      // a follow-up can add activity-driven extends if user
      // workflows need longer.
      void this._api
        .setRemoteBuildPairingWindow({ open: true })
        .catch(() => {
          // Soft-toast on failure rather than crashing the
          // section render — admin can re-enter the section to
          // retry, or the receiver-side state becomes visible
          // via the ``_buildServerPairingWindowState`` context
          // either way.
          this._toast(
            "warning",
            "settings.build_server_pairing_window_open_failed"
          );
        });
    }
    // Send-builds section consumes ``_buildOffloadDiscoveredHosts``
    // directly via context — app-shell seeded it from
    // ``initial_state.hosts`` on subscribe and mutates it on
    // ``REMOTE_BUILD_HOST_ADDED`` / ``REMOTE_BUILD_HOST_REMOVED``.
    // Nothing to fetch on section enter.
  }

  /**
   * Fetch the receiver identity for the Build server card.
   *
   * Idempotent on the backend ('get_identity' lazy-creates the
   * X25519 peer-link keypair on first call but never rotates),
   * so re-firing on dialog re-open or after a rotate just
   * refreshes the local state. Tracks failure separately from
   * the null-while-loading state so the UI can render an
   * explicit error message rather than spinning forever.
   *
   * Cross-tab refresh on a rotation from another tab is handled
   * by ``updated()`` watching the
   * ``buildServerIdentityRotationCounterContext`` value
   * app-shell bumps from the
   * ``remote_build_identity_rotated`` event (3c2d).
   */
  private async _loadBuildServerIdentity(): Promise<void> {
    if (this._api === undefined) {
      return;
    }
    try {
      this._buildServerIdentity = await this._api.getRemoteBuildIdentity();
      this._buildServerIdentityLoadFailed = false;
    } catch (err) {
      console.warn("Could not load remote-build identity:", err);
      this._buildServerIdentityLoadFailed = true;
    }
  }

  /**
   * Open the dedicated accept-peer dialog for a PENDING row.
   *
   * Routes through ``<esphome-accept-peer-dialog>`` rather than
   * approving inline because granting a sender pairing here gives
   * it the ability to dispatch compile jobs to this dashboard,
   * which is effectively code-execution access on the host. The
   * dialog re-shows the OOB pin so the operator can sanity-check
   * it against the sender's display, plus a security warning
   * that calls out the access scope. The actual approve call
   * lives in :meth:`_onApprovePeer`, wired via the dialog's
   * ``@confirm`` event.
   */
  private _onAcceptPeerRequest(peer: PeerSummary) {
    this._acceptPeerDialog?.open(peer);
  }

  /**
   * Approve a PENDING peer.
   *
   * Idempotent on the backend (already-approved → no-op
   * success); returning ``ErrorCode.NOT_FOUND`` if the row is
   * gone (concurrent reject in another tab) is soft-toasted
   * because the user-visible outcome — the row drops from the
   * inbox — is the same as if the approve had succeeded against
   * a no-longer-pending row. Subsequent
   * ``REMOTE_BUILD_PAIR_STATUS_CHANGED`` event re-syncs the
   * list either way.
   */
  private async _onAcceptPeerConfirm(
    e: CustomEvent<{ dashboardId: string }>
  ) {
    await this._onApprovePeer(e.detail.dashboardId);
  }

  private async _onApprovePeer(dashboardId: string) {
    if (this._api === undefined) {
      return;
    }
    try {
      await this._api.approveRemoteBuildPeer({ dashboard_id: dashboardId });
    } catch (err) {
      if (err instanceof APIError && err.errorCode === ErrorCode.NOT_FOUND) {
        this._toast(
          "warning",
          "settings.build_server_peer_approve_already_gone"
        );
      } else {
        this._toast("error", "settings.build_server_peer_approve_failed");
      }
      // The list mutates automatically via the
      // ``REMOTE_BUILD_PAIR_STATUS_CHANGED`` event the backend
      // fires on success; nothing to refetch on failure either
      // — the visible row is still the pre-error pending row,
      // and a follow-up event (concurrent admin in another tab)
      // would update it through the same path.
      return;
    }
    this._toast("success", "settings.build_server_peer_approve_success");
  }

  /**
   * Open the shared confirm-dialog for removing an APPROVED peer.
   *
   * PENDING peers' Reject path no longer routes through here; it
   * lives in the dedicated ``<esphome-accept-peer-dialog>`` so
   * the operator decides Accept vs. Reject in the same security-
   * warning context. The shared confirm-dialog is now Remove-only.
   */
  private _onRemovePeerRequest(dashboardId: string) {
    this._pendingPeerRemove = { dashboardId };
    this._peerRemoveConfirmDialog?.open();
  }

  private async _onRemovePeerConfirm() {
    const action = this._pendingPeerRemove;
    this._pendingPeerRemove = null;
    if (this._api === undefined || action === null) {
      return;
    }
    await this._removePeer(action.dashboardId, "remove");
  }

  /**
   * Reject a PENDING peer (from the accept-peer dialog's Reject
   * button). The dialog itself is the confirmation step — there's
   * no second confirm modal — so this fires the ``removePeer``
   * call straight through and uses the existing reject-toast keys.
   */
  private async _onRejectPeerFromDialog(
    e: CustomEvent<{ dashboardId: string }>
  ) {
    await this._removePeer(e.detail.dashboardId, "reject");
  }

  /**
   * Shared peer-removal helper for both the APPROVED-row Remove
   * path and the PENDING-row Reject path. The wire call
   * (``removeRemoteBuildPeer``) is identical; the toast copy
   * differs because rejecting a still-pending request and
   * removing an already-paired sender feel like distinct actions
   * to the operator. The bus event the backend fires
   * (``REMOTE_BUILD_PAIR_STATUS_CHANGED`` with
   * ``status="removed"``) drops the row from the
   * context-provided list automatically.
   */
  private async _removePeer(
    dashboardId: string,
    kind: "reject" | "remove",
  ) {
    if (this._api === undefined) {
      return;
    }
    const toastPrefix =
      kind === "reject"
        ? "settings.build_server_peer_reject"
        : "settings.build_server_peer_remove";
    try {
      await this._api.removeRemoteBuildPeer({ dashboard_id: dashboardId });
    } catch (err) {
      if (err instanceof APIError && err.errorCode === ErrorCode.NOT_FOUND) {
        // Row already gone (concurrent action in another tab).
        // Soft-toast; the visible-state-after is the same as a
        // successful reject / remove, so the user doesn't need
        // to retry.
        this._toast("warning", `${toastPrefix}_already_gone`);
      } else {
        this._toast("error", `${toastPrefix}_failed`);
      }
      return;
    }
    this._toast("success", `${toastPrefix}_success`);
  }

  private _onRotateRequest() {
    // Open the shared ``<esphome-confirm-dialog>`` rather than
    // rotating immediately. Rotation is a security-sensitive
    // action that invalidates every paired sender's pin;
    // a single misclick shouldn't trigger that cascade. The
    // confirm dialog (shared component, destructive style)
    // spells out the consequence so the user has to
    // acknowledge it; the rotate body lives in
    // ``_onRotateConfirm`` and is wired via the dialog's
    // ``@confirm`` event.
    this._rotateConfirmDialog?.open();
  }

  /**
   * Localised + ``richColors``-styled toast shorthand.
   *
   * The richColors-styled toast pattern repeats six times in
   * the rotate / copy / mismatch flows; centralising it here
   * keeps each call site to a single line and a single point
   * of change for the styling contract.
   */
  private _toast(
    level: "success" | "warning" | "error",
    key: string,
    values?: Record<string, string | number>,
  ) {
    toast[level](this._localize(key, values), { richColors: true });
  }

  /**
   * Start the 1Hz tick if it isn't already running.
   *
   * Bumps ``_pairingTick`` purely to nudge Lit into re-rendering;
   * the displayed remaining-seconds value is computed from the
   * anchor + baseline at render time via :func:`remainingOf`.
   * Same idiom as ``firmware-jobs-dialog._startTicker`` and
   * ``device-drawer-content._tickInterval`` so a future shared
   * tick controller can pick up all three in one go.
   *
   * Idempotent; repeated calls (e.g. successive
   * ``remote_build_pairing_window_changed`` events that re-seed
   * the anchor) leave the existing handle alone.
   */
  private _startPairingTick() {
    if (this._pairingTickHandle !== null) return;
    this._pairingTickHandle = setInterval(() => {
      this._pairingTick = (this._pairingTick + 1) % 1000;
    }, 1000);
  }

  private _stopPairingTick() {
    if (this._pairingTickHandle !== null) {
      clearInterval(this._pairingTickHandle);
      this._pairingTickHandle = null;
    }
  }

  /**
   * Derive the live remaining seconds from the anchor + baseline
   * captured on the most recent
   * ``remote_build_pairing_window_changed`` event. Returns
   * ``null`` when the window is closed.
   */
  private _pairingRemainingSeconds(): number | null {
    return remainingOf(
      this._pairingBaselineSeconds,
      this._pairingAnchorMs,
      Date.now(),
    );
  }

  /**
   * Format a remaining-seconds count as ``M:SS``.
   *
   * Returns an empty string for ``null`` so the caller can drop
   * the countdown chip when the window has closed without
   * branching at the call site.
   */
  private _formatPairingDuration(seconds: number | null): string {
    if (seconds === null) return "";
    const whole = Math.floor(seconds);
    const m = Math.floor(whole / 60);
    const s = whole % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  /**
   * Refresh the pairing window's idle deadline.
   *
   * The receiver-side window auto-closes 5min after the most
   * recent open / extend tick from any client. The Extend button
   * in the Pairing requests header re-issues ``open: true`` so
   * the operator can keep the door open through a longer
   * verification conversation without the screen silently
   * timing out mid-call.
   *
   * The 5-minute duration is hardcoded server-side; the
   * ``set_pairing_window`` WS arg shape only carries
   * ``{ open: boolean }`` and there's no per-call duration knob.
   * That's a YAGNI knob right now — every flow we have today
   * fits comfortably under 5 minutes and the Extend button
   * covers the long-tail "operator is on a phone call with the
   * other side" case. If a future flow needs a longer or
   * configurable window the right shape is a backend-side
   * ``duration_seconds`` arg, not a frontend-only override.
   */
  private _onExtendPairingWindow = () => {
    if (this._api === undefined) return;
    void this._api
      .setRemoteBuildPairingWindow({ open: true })
      .catch(() => {
        this._toast(
          "warning",
          "settings.build_server_pairing_window_extend_failed"
        );
      });
  };

  private async _onRotateConfirm() {
    if (this._api === undefined || this._buildServerRotateInFlight) {
      return;
    }
    // Optimistic-update would be wrong here: a rotate hands
    // back a wholly new pin that the frontend can't predict
    // (it's the SHA-256 of the freshly-generated X25519 public
    // key), so there's nothing we can pre-fill. Just gate the
    // button on '_buildServerRotateInFlight' and toast the
    // result.
    this._buildServerRotateInFlight = true;
    try {
      this._buildServerIdentity = await this._api.rotateRemoteBuildIdentity();
      this._buildServerIdentityLoadFailed = false;
      if (this._buildServerIdentity.listener_bound) {
        this._toast("success", "settings.remote_build_rotate_success");
      } else {
        // Listener didn't come back up after the rebuild.
        // Backend's ``reload_remote_build_identity`` is
        // fail-soft; the operator should check logs. Surface
        // this distinct from generic failure so they don't
        // think the rotation didn't happen.
        this._toast("warning", "settings.remote_build_rotate_listener_down");
      }
    } catch (err) {
      if (err instanceof APIError && err.errorCode === ErrorCode.ALREADY_EXISTS) {
        // 3c1 single-flight: another rotation is in progress
        // (possibly from another tab). The button is disabled
        // while ``_buildServerRotateInFlight`` is true on this
        // tab, but not the other tab's. Toast distinct from
        // generic failure so the user knows to wait, not retry.
        this._toast("warning", "settings.remote_build_rotate_already_in_progress");
      } else {
        this._toast("error", "settings.remote_build_rotate_failed");
      }
    } finally {
      this._buildServerRotateInFlight = false;
    }
  }

  private async _onCopyPin() {
    // Defensive: refuse to "successfully" copy an empty value.
    // A stale ``_buildServerIdentity`` or a state-glitch where
    // ``pin_sha256`` is briefly empty would otherwise produce
    // a "Copied!" toast while putting nothing on the clipboard
    // — exactly the failure mode that's confusing to debug
    // because the toast lies. If the pin is missing, surface
    // the same error toast as a true copy failure so the user
    // knows to refresh.
    const pin = this._buildServerIdentity?.pin_sha256;
    if (!pin) {
      this._toast("warning", "settings.remote_build_pin_copy_failed");
      return;
    }
    // Copy the unformatted (no-spaces) pin so a paste into a
    // compare-with-receiver field doesn't pick up the OOB
    // display formatting. The display formatting is for the
    // human's eyes; programmatic comparison wants the raw form.
    //
    // Goes through ``copyToClipboard`` (rather than
    // ``navigator.clipboard.writeText`` directly) because the
    // modern Clipboard API requires a "secure context" — the
    // dashboard is frequently reached on HTTP at non-localhost
    // LAN IPs (HA-addon direct port, container deployments)
    // where ``navigator.clipboard`` is undefined or throws
    // ``NotAllowedError``. The helper falls back to a hidden
    // ``<span>`` + Selection API + ``execCommand("copy")`` in
    // those contexts (see ``util/copy-to-clipboard.ts``).
    if (await copyToClipboard(pin)) {
      this._toast("success", "settings.remote_build_pin_copied");
    } else {
      // Surface the failure rather than silently no-op; the
      // user clicked a button and deserves feedback. They can
      // still read the pin off the card and copy it manually.
      this._toast("warning", "settings.remote_build_pin_copy_failed");
    }
  }

  static styles = [
    espHomeStyles,
    pinHexStyles,
    css`
      esphome-base-dialog {
        --width: min(800px, 95vw);
      }

      esphome-base-dialog::part(header) {
        background: var(--esphome-primary);
        /* Right padding is 0 so the 40x40 close button (sized via
           dialogCloseButtonStyles) sits flush with the dialog's
           corner. */
        padding: 0 0 0 var(--wa-space-m);
        height: 40px;
        box-sizing: border-box;
      }

      esphome-base-dialog::part(title) {
        color: var(--esphome-on-primary);
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
      }

      esphome-base-dialog::part(footer) {
        display: none;
      }

      esphome-base-dialog::part(body) {
        padding: 0;
      }

      .layout {
        display: flex;
        height: min(500px, 70vh);
      }

      .sidebar {
        width: 220px;
        flex-shrink: 0;
        background: var(--wa-color-surface-default);
        border-right: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        padding: var(--wa-space-m) var(--wa-space-xs);
        overflow-y: auto;
      }

      .nav {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .nav-item {
        display: flex;
        align-items: center;
        gap: var(--wa-space-s);
        padding: 8px var(--wa-space-s);
        border: none;
        background: transparent;
        border-radius: var(--wa-border-radius-m);
        font-size: var(--wa-font-size-s);
        font-family: inherit;
        color: var(--wa-color-text-normal);
        cursor: pointer;
        text-align: left;
        transition:
          background 0.12s,
          color 0.12s,
          text-shadow 0.12s;
      }

      .nav-item:hover,
      .nav-item--active {
        background: var(--wa-color-surface-lowered);
        color: var(--wa-color-text-normal);
        /* Fake bold via text-shadow so the layout doesn't reflow on hover.
           Changing real font-weight widens the text, the cursor falls off
           the element, the hover drops, and you get the flicker. */
        text-shadow:
          0.4px 0 0 currentColor,
          -0.4px 0 0 currentColor;
      }

      .nav-item:hover wa-icon,
      .nav-item--active wa-icon {
        color: var(--wa-color-text-normal);
      }

      .nav-item wa-icon {
        font-size: 18px;
        color: var(--wa-color-text-quiet);
        transition: color 0.12s;
      }

      .content {
        flex: 1;
        display: flex;
        flex-direction: column;
        min-width: 0;
        overflow: hidden;
      }

      .content-body {
        flex: 1;
        padding: 0 var(--wa-space-l);
        padding-bottom: var(--wa-space-l);
        overflow-y: auto;
      }

      .row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wa-space-m);
        padding: var(--wa-space-m) 0;
        border-bottom: var(--wa-border-width-s) solid var(--wa-color-surface-border);
      }

      .row:last-child {
        border-bottom: none;
      }

      .row-label {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }

      .row-title {
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-normal);
      }

      .row-desc {
        font-size: var(--wa-font-size-xs);
        color: var(--wa-color-text-quiet);
      }

      wa-select {
        min-width: 180px;
      }

      .toggle {
        position: relative;
        width: 40px;
        height: 22px;
        border: none;
        border-radius: 11px;
        background: var(--wa-color-surface-border);
        cursor: pointer;
        transition: background 0.15s;
        padding: 0;
        flex-shrink: 0;
      }

      .toggle[aria-checked="true"] {
        background: var(--esphome-primary);
      }

      .toggle::after {
        content: "";
        position: absolute;
        top: 3px;
        left: 3px;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: white;
        transition: transform 0.15s;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
      }

      .toggle[aria-checked="true"]::after {
        transform: translateX(18px);
      }

      /* 6c cache-cleanup TTL input. Number + unit label sit on
         one line at the row's trailing edge, matching the
         toggle's flex-shrink placement above. */
      .cleanup-ttl-input {
        display: inline-flex;
        align-items: baseline;
        gap: var(--wa-space-2xs);
        flex-shrink: 0;
      }

      .cleanup-ttl-number {
        width: 5em;
        text-align: right;
        padding: var(--wa-space-2xs) var(--wa-space-xs);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        border-radius: var(--wa-border-radius-m);
        background: var(--wa-color-surface-default);
        color: var(--wa-color-text-normal);
        font-family: inherit;
        font-size: var(--wa-font-size-s);
      }

      .cleanup-ttl-number:focus {
        outline: none;
        border-color: var(--esphome-primary);
        box-shadow: 0 0 0 2px
          color-mix(in srgb, var(--esphome-primary), transparent 80%);
      }

      .cleanup-ttl-unit {
        font-size: var(--wa-font-size-s);
        color: var(--wa-color-text-quiet);
      }

      /* Remote builder sections (Build server / Send builds).
         No per-element horizontal padding — .content-body
         already pads the section's left/right edges via
         padding: 0 var(--wa-space-l). Adding more horizontal
         padding here would compound on top of that, leaving
         the content visually crammed against a thick gutter
         (the symptom that prompted this cleanup). The
         Appearance / Editor sections use the same pattern
         via .row: zero horizontal padding, rely on the
         container. */

      /* Nav-sidebar group header. Renders above grouped
         sections in the left rail (currently the EXPERIMENTAL
         group containing Build server, Pairing requests, and
         Send builds). Same visual treatment as the in-content
         '.section-heading'
         small-caps subtitles -- uppercase, tracked, quiet
         colour, hairline divider above -- so the eye reads the
         group as "sectioning" rather than "another nav item".
         Lives in the nav layer rather than as an inline content
         banner: replaces the previous verbose
         'build_offload_unimplemented_banner' copy with a
         lightweight structural signal in the navigation. */
      .nav-group-header {
        font-size: var(--wa-font-size-2xs);
        font-weight: var(--wa-font-weight-bold);
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--wa-color-text-quiet);
        padding: var(--wa-space-s) var(--wa-space-s) var(--wa-space-2xs);
        margin-top: var(--wa-space-s);
        border-top: 1px solid var(--wa-color-surface-border);
      }

      /* Binding-mismatch alert rows. Same shape as
         .phase-banner; the per-severity colour stack diverges
         (warning for race-loss, danger for the loud already-
         bound case). Two-column layout when the loud case
         renders a Revoke CTA, single-column otherwise. */
      .binding-alerts {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-xs);
        margin: 0 0 var(--wa-space-m);
      }

      .binding-alert {
        display: flex;
        align-items: flex-start;
        gap: var(--wa-space-m);
        padding: var(--wa-space-s) var(--wa-space-m);
        border-radius: var(--wa-border-radius-s);
        border-left: 3px solid;
        font-size: var(--wa-font-size-s);
      }

      .binding-alert[data-severity="warning"] {
        background: var(--wa-color-warning-fill-quiet, #fff7e0);
        color: var(--wa-color-warning-text-quiet, #6b4f00);
        border-left-color: var(--wa-color-warning-border-loud, #f0b400);
      }

      .binding-alert[data-severity="danger"] {
        background: color-mix(in srgb, var(--esphome-error), transparent 92%);
        color: var(--esphome-error);
        border-left-color: var(--esphome-error);
      }

      .binding-alert-body {
        flex: 1;
        min-width: 0;
      }

      .binding-alert-title {
        font-weight: var(--wa-font-weight-bold);
        margin-bottom: var(--wa-space-2xs);
      }

      .binding-alert-desc {
        font-size: var(--wa-font-size-xs);
        line-height: 1.4;
      }

      .binding-alert-revoke {
        flex-shrink: 0;
        align-self: center;
        padding: 6px 14px;
        border-radius: var(--wa-border-radius-s);
        background: var(--esphome-error);
        color: var(--esphome-on-primary, white);
        border: none;
        font: inherit;
        font-weight: var(--wa-font-weight-bold);
        font-size: var(--wa-font-size-xs);
        cursor: pointer;
      }

      .binding-alert-revoke:hover {
        background: color-mix(in srgb, var(--esphome-error), black 10%);
      }

      .section-intro {
        font-size: var(--wa-font-size-s);
        color: var(--wa-color-text-quiet);
        margin: 0 0 var(--wa-space-s);
      }

      .section-heading {
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-semibold);
        color: var(--wa-color-text-quiet);
        text-transform: uppercase;
        letter-spacing: 0.04em;
        margin: var(--wa-space-l) 0 var(--wa-space-xs);
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: var(--wa-space-xs);
      }

      /* Pairing-window status display (pill + countdown +
         Extend button) lives inline with the section heading.
         Children reset text-transform so they aren't uppercased
         by the heading; the heading's uppercase only applies
         to the section title text itself. */
      .pairing-window-pill,
      .pairing-window-countdown,
      .pairing-window-extend {
        text-transform: none;
        letter-spacing: normal;
        font-weight: var(--wa-font-weight-semibold);
      }

      .pairing-window-pill {
        font-size: var(--wa-font-size-xs);
        padding: 1px 8px;
        border-radius: var(--wa-border-radius-pill, 999px);
      }

      .pairing-window-open {
        background: color-mix(in srgb, var(--esphome-success, #16a34a), transparent 80%);
        color: var(--esphome-success, #16a34a);
      }

      .pairing-window-closed {
        background: var(--wa-color-surface-lowered);
        color: var(--wa-color-text-quiet);
      }

      .pairing-window-countdown {
        font-family: var(--wa-font-family-mono, monospace);
        font-size: var(--wa-font-size-xs);
        color: var(--wa-color-text-normal);
        font-variant-numeric: tabular-nums;
      }

      .pairing-window-extend {
        margin-inline-start: auto;
        padding: 2px 10px;
        border-radius: var(--wa-border-radius-s);
        background: var(--wa-color-surface-raised);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        color: var(--wa-color-text-normal);
        font: inherit;
        font-size: var(--wa-font-size-xs);
        font-weight: var(--wa-font-weight-semibold);
        cursor: pointer;
      }

      .pairing-window-extend:hover,
      .pairing-window-extend:focus-visible {
        background: var(--wa-color-surface-border);
      }

      .peer-row .row-title {
        display: flex;
        align-items: center;
        gap: var(--wa-space-xs);
      }

      .pair-build-server-row {
        align-items: center;
        gap: var(--wa-space-s);
      }

      .btn-pair-build-server {
        height: 36px;
        padding: 0 var(--wa-space-m);
        border: none;
        border-radius: var(--wa-border-radius-s);
        background: var(--esphome-primary);
        color: var(--esphome-on-primary);
        font: inherit;
        font-weight: var(--wa-font-weight-semibold);
        cursor: pointer;
        flex-shrink: 0;
      }

      .btn-pair-build-server:hover:not(:disabled) {
        background: color-mix(in srgb, var(--esphome-primary), black 10%);
      }

      .btn-pair-build-server:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .btn-pair-row {
        height: 32px;
        font-size: var(--wa-font-size-xs);
      }

      .btn-unpair {
        height: 32px;
        padding: 0 var(--wa-space-m);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        border-radius: var(--wa-border-radius-s);
        background: var(--wa-color-surface-default);
        color: var(--wa-color-text-quiet);
        font: inherit;
        font-size: var(--wa-font-size-xs);
        font-weight: var(--wa-font-weight-semibold);
        cursor: pointer;
        flex-shrink: 0;
      }

      .btn-unpair:hover {
        background: color-mix(in srgb, var(--esphome-error), white 90%);
        color: var(--esphome-error);
        border-color: var(--esphome-error);
      }

      /* Icon-only edit button on a paired row — opens the
         hostname / port edit dialog (8b). Sized to match the
         32px height of the sibling Unpair / View build buttons
         so the row's vertical rhythm stays consistent. */
      .btn-edit-endpoint {
        height: 32px;
        width: 32px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        border-radius: var(--wa-border-radius-s);
        background: var(--wa-color-surface-default);
        color: var(--wa-color-text-quiet);
        cursor: pointer;
        flex-shrink: 0;
      }

      .btn-edit-endpoint:hover {
        background: color-mix(
          in srgb,
          var(--esphome-primary),
          white 90%
        );
        color: var(--esphome-primary);
        border-color: var(--esphome-primary);
      }

      .btn-edit-endpoint wa-icon {
        font-size: 16px;
      }

      .pairing-row {
        align-items: center;
        gap: var(--wa-space-s);
      }

      .offloader-alert {
        display: flex;
        align-items: flex-start;
        gap: var(--wa-space-m);
        padding: var(--wa-space-m);
        margin: var(--wa-space-s) var(--wa-space-m);
        border-radius: var(--wa-border-radius-m);
        border-left: 4px solid var(--esphome-warning, #f59e0b);
        background: color-mix(
          in srgb,
          var(--esphome-warning, #f59e0b),
          transparent 92%
        );
      }

      .offloader-alert-peer-revoked {
        border-left-color: var(--esphome-error, #dc2626);
        background: color-mix(
          in srgb,
          var(--esphome-error, #dc2626),
          transparent 92%
        );
      }

      .offloader-alert-body {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-2xs);
      }

      .offloader-alert-title {
        font-weight: var(--wa-font-weight-semibold);
        font-size: var(--wa-font-size-s);
        color: var(--wa-color-text);
      }

      .offloader-alert-desc {
        font-size: var(--wa-font-size-s);
        color: var(--wa-color-text-quiet);
      }

      .offloader-alert-actions {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-xs);
        flex-shrink: 0;
      }

      .pairing-status-pill {
        display: inline-block;
        padding: 1px 6px;
        margin-left: var(--wa-space-xs);
        border-radius: 4px;
        font-size: var(--wa-font-size-xs);
        font-weight: var(--wa-font-weight-semibold);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      /* Same shape as .pairing-status-pill, separate class so
         the receiver-side Paired-senders connection pill can
         track the offloader-side pairing-status pill stylistic
         changes without one accidentally inheriting the
         other's colour palette. */
      .peer-connection-pill {
        display: inline-block;
        padding: 1px 6px;
        margin-left: var(--wa-space-xs);
        border-radius: 4px;
        font-size: var(--wa-font-size-xs);
        font-weight: var(--wa-font-weight-semibold);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .peer-connection-connected {
        background: color-mix(
          in srgb,
          var(--esphome-success, #16a34a),
          transparent 80%
        );
        color: var(--esphome-success, #16a34a);
      }

      .peer-connection-disconnected {
        background: color-mix(
          in srgb,
          var(--wa-color-neutral-500, #6b7280),
          transparent 80%
        );
        color: var(--wa-color-neutral-500, #6b7280);
      }

      /* Same warning-tint as Pending: the row is between
         states (Connecting…) and the operator's prompt is
         "wait" rather than "act," same posture Pending
         conveys. Distinct class so a future colour shift on
         either pill doesn't drag the other along. */
      .peer-connection-connecting {
        background: color-mix(
          in srgb,
          var(--esphome-warning, #f59e0b),
          transparent 80%
        );
        color: var(--esphome-warning, #f59e0b);
      }

      /* Sub-line under any not-currently-connected APPROVED row
         showing the backend's last_connect_error so the operator
         sees the specific failure (e.g. "ConnectionRefusedError:
         [Errno 61] Connection refused") without trawling logs.
         Renders during both Connecting… (run loop is retrying)
         and the orphan-disconnected case. Quiet styling — same
         font as the existing row-desc but italic for visual
         grouping with the line above. */
      .pairing-last-error {
        font-style: italic;
        word-break: break-word;
      }

      /* Sub-line under any APPROVED row whose receiver
         reports a different esphome_version than the
         offloader's bundled version. Two shades: --patch
         is informational (same year+month, just a
         different patch / dev / beta build) and inherits
         the quiet row-desc colour; --release is
         cautionary (different year+month; YAMLs may not
         compile cleanly across the gap) and uses the
         warning palette to draw the eye. Once 7b's
         allow-major-version-mismatch toggle and 7a's
         scheduler land, the --release case becomes the
         signal the operator has to explicitly accept; the
         banner here is the visible cue ahead of that. */
      .pairing-version-mismatch {
        word-break: break-word;
      }
      .pairing-version-mismatch--release {
        color: var(--esphome-warning, #f59e0b);
      }

      .pairing-status-pending {
        background: color-mix(
          in srgb,
          var(--esphome-warning, #f59e0b),
          transparent 80%
        );
        color: var(--esphome-warning, #f59e0b);
      }

      .pairing-status-approved {
        background: color-mix(
          in srgb,
          var(--esphome-success, #16a34a),
          transparent 80%
        );
        color: var(--esphome-success, #16a34a);
      }

      .peer-remove {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        border: none;
        border-radius: var(--wa-border-radius-s);
        background: transparent;
        color: var(--wa-color-text-quiet);
        cursor: pointer;
        flex-shrink: 0;
      }

      .peer-remove:hover,
      .peer-remove:focus-visible {
        background: var(--wa-color-surface-border);
        color: var(--wa-color-text);
      }

      .build-server-card {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-s);
        padding: var(--wa-space-m);
        margin: 0 var(--wa-space-m) var(--wa-space-m) var(--wa-space-m);
        background: var(--wa-color-surface-default);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        border-radius: var(--wa-border-radius-m);
      }

      .build-server-row {
        display: flex;
        align-items: baseline;
        gap: var(--wa-space-s);
        flex-wrap: wrap;
      }

      .build-server-label {
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-semibold);
        color: var(--wa-color-text-quiet);
        min-width: 110px;
      }

      .build-server-pin {
        font-family: var(--wa-font-family-mono, monospace);
        font-size: var(--wa-font-size-xs);
        word-break: break-all;
        flex: 1;
      }

      /* Pin label sits next to the emoji grid + collapsible
         hex; the row needs to stack vertically rather than
         wrap inline so the emoji grid gets its own line. */
      .build-server-row--pin {
        align-items: flex-start;
      }

      .build-server-pin-display {
        display: flex;
        flex-direction: column;
        gap: 6px;
        flex: 1;
        min-width: 0;
      }

      /* .pin-hex disclosure styling lives in styles/pin-hex.ts;
         no per-component extras needed here. */

      .build-server-dashboard-id {
        font-family: var(--wa-font-family-mono, monospace);
        font-size: var(--wa-font-size-s);
        word-break: break-all;
        flex: 1;
      }

      .build-server-versions {
        display: flex;
        gap: var(--wa-space-l);
        font-size: var(--wa-font-size-s);
        color: var(--wa-color-text-quiet);
      }

      .build-server-versions code {
        font-family: var(--wa-font-family-mono, monospace);
        color: var(--wa-color-text-normal);
        margin-left: var(--wa-space-xs);
      }

      .build-server-actions {
        display: flex;
        gap: var(--wa-space-s);
        align-items: center;
        flex-wrap: wrap;
      }

      .build-server-copy,
      .build-server-rotate {
        padding: 6px var(--wa-space-m);
        background: var(--wa-color-surface-raised);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        border-radius: var(--wa-border-radius-s);
        color: var(--wa-color-text-normal);
        font-family: inherit;
        font-size: var(--wa-font-size-s);
        cursor: pointer;
      }

      .build-server-rotate {
        color: var(--wa-color-danger-on-quiet, #b00020);
        border-color: var(--wa-color-danger-on-quiet, #b00020);
      }

      .build-server-rotate:disabled,
      .build-server-copy:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      .build-server-listener-badge {
        display: inline-flex;
        align-items: center;
        padding: 2px var(--wa-space-s);
        border-radius: var(--wa-border-radius-pill, 999px);
        font-size: var(--wa-font-size-xs);
        font-weight: var(--wa-font-weight-semibold);
      }

      .build-server-listener-up {
        background: var(--wa-color-success-quiet, #d6f5dd);
        color: var(--wa-color-success-on-quiet, #036a1c);
      }

      .build-server-listener-down {
        background: var(--wa-color-warning-quiet, #fff3cd);
        color: var(--wa-color-warning-on-quiet, #8a6d3b);
      }

      /* Tokens list (3c2c) */

      .token-row .row-desc {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wa-space-s);
        margin-top: 4px;
      }

      .token-id {
        font-family: var(--wa-font-family-mono, monospace);
        font-size: var(--wa-font-size-xs);
        background: var(--wa-color-surface-lowered);
        padding: 1px 6px;
        border-radius: var(--wa-border-radius-s);
      }

      .token-meta {
        font-size: var(--wa-font-size-xs);
        color: var(--wa-color-text-quiet);
      }

      .token-bound-badge {
        font-size: var(--wa-font-size-xs);
        font-weight: var(--wa-font-weight-semibold);
        padding: 2px var(--wa-space-s);
        border-radius: var(--wa-border-radius-pill, 999px);
      }

      .token-bound-unbound {
        background: var(--wa-color-surface-lowered);
        color: var(--wa-color-text-quiet);
      }

      .token-bound-bound {
        background: var(--wa-color-success-quiet, #d6f5dd);
        color: var(--wa-color-success-on-quiet, #036a1c);
      }

      .token-revoke {
        padding: 6px var(--wa-space-m);
        background: var(--wa-color-surface-raised);
        border: var(--wa-border-width-s) solid
          var(--wa-color-danger-on-quiet, #b00020);
        border-radius: var(--wa-border-radius-s);
        color: var(--wa-color-danger-on-quiet, #b00020);
        font: inherit;
        font-size: var(--wa-font-size-s);
        cursor: pointer;
        flex-shrink: 0;
      }

      .tokens-actions {
        margin-top: var(--wa-space-m);
      }

      .tokens-generate {
        padding: 8px var(--wa-space-m);
        background: var(--esphome-primary);
        color: var(--esphome-on-primary);
        border: var(--wa-border-width-s) solid var(--esphome-primary);
        border-radius: var(--wa-border-radius-s);
        font: inherit;
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-semibold);
        cursor: pointer;
      }

      @media (max-width: 700px) {
        .layout {
          flex-direction: column;
          height: auto;
        }
        .sidebar {
          width: auto;
          border-right: none;
          border-bottom: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        }
        .nav {
          flex-direction: row;
          flex-wrap: wrap;
        }
      }
    `,
  ];

  protected render() {
    const current = SECTIONS.find((s) => s.id === this._section) ?? SECTIONS[0];

    return html`
      <esphome-base-dialog
        ?open=${this._open}
        .label="${this._localize("settings.title")} - ${this._localize(current.labelKey)}"
        @request-close=${this._onDialogRequestClose}
        @after-hide=${this._onDialogAfterHide}
      >
        <div class="layout">
          <aside class="sidebar">
            <nav class="nav">
              ${this._renderNav()}
            </nav>
          </aside>
          <main class="content">
            <div class="content-body">${this._renderSection()}</div>
          </main>
        </div>
      </esphome-base-dialog>
    `;
  }

  /**
   * Render the nav sidebar.
   *
   * Flat sections (no 'group') render first as a single
   * list. Grouped sections render after, each group preceded
   * by a small uppercase header (currently only the
   * 'experimental' group is used, surfaced as 'EXPERIMENTAL'
   * above the three remote-build screens: Build server,
   * Pairing requests, and Send builds). The grouped pattern
   * replaces the previous inline-banner approach -- "this
   * feature is still in development" lives in the nav
   * structure rather than as a paragraph at the top of the
   * section content.
   */
  private _renderNav() {
    const flat = SECTIONS.filter((s) => !s.group);
    const experimental = SECTIONS.filter((s) => s.group === "experimental");
    const renderItem = (s: SectionDef) => html`
      <button
        class="nav-item ${s.id === this._section ? "nav-item--active" : ""}"
        @click=${() => this._selectSection(s.id)}
      >
        <wa-icon library="mdi" name=${s.icon}></wa-icon>
        <span>${this._localize(s.labelKey)}</span>
      </button>
    `;
    return html`
      ${flat.map(renderItem)}
      ${experimental.length
        ? html`
            <div class="nav-group-header">
              ${this._localize("settings.experimental_tag")}
            </div>
            ${experimental.map(renderItem)}
          `
        : nothing}
    `;
  }

  private _renderSection() {
    switch (this._section) {
      case "appearance":
        return this._renderAppearance();
      case "language":
        return this._renderLanguage();
      case "editor":
        return this._renderEditor();
      case "build_server":
        return this._renderBuildServer();
      case "pairing_requests":
        return this._renderPairingRequestsSection();
      case "build_offload":
        return this._renderBuildOffload();
    }
  }

  private _renderAppearance() {
    return html`
      <div class="row">
        <div class="row-label">
          <span class="row-title">${this._localize("layout.theme")}</span>
          <span class="row-desc">${this._localize("settings.theme_desc")}</span>
        </div>
        <wa-select value=${this._theme} @change=${this._onThemeChange}>
          <wa-option value="light">${this._localize("layout.theme_light")}</wa-option>
          <wa-option value="dark">${this._localize("layout.theme_dark")}</wa-option>
          <wa-option value="system">${this._localize("layout.theme_system")}</wa-option>
        </wa-select>
      </div>
    `;
  }

  private _renderLanguage() {
    return html`
      <div class="row">
        <div class="row-label">
          <span class="row-title">${this._localize("settings.language")}</span>
          <span class="row-desc">${this._localize("settings.language_desc")}</span>
        </div>
        <wa-select value=${this._language} @change=${this._onLanguageChange}>
          ${LANGUAGES.map(
            (l) => html`
              <wa-option value=${l.value}>${this._localize(l.labelKey)}</wa-option>
            `
          )}
        </wa-select>
      </div>
    `;
  }

  private _renderEditor() {
    // ``aria-checked`` is the string-attribute form
    // (``aria-checked=${value}``). Lit's ``?aria-checked=...``
    // boolean binding would omit the attribute entirely on
    // ``false``, breaking both the ``[aria-checked="false"]`` CSS
    // state and the screen-reader announcement. ``aria-labelledby``
    // points at the row title so the toggle has an accessible
    // name; without it screen readers announce only "switch,
    // checked" with no context.
    return html`
      <div class="row">
        <div class="row-label">
          <span id="yaml-diff-title" class="row-title">
            ${this._localize("settings.show_yaml_diff_button")}
          </span>
          <span class="row-desc">
            ${this._localize("settings.show_yaml_diff_button_desc")}
          </span>
        </div>
        <button
          class="toggle"
          role="switch"
          aria-labelledby="yaml-diff-title"
          aria-checked=${this._yamlDiffButton}
          @click=${this._onToggleDiff}
        ></button>
      </div>
    `;
  }

  /**
   * Receive role: this dashboard letting other dashboards use
   * it to compile firmware. Master enable toggle + the
   * build-server identity card (identity fingerprint +
   * listener-bound + rotate). The pairing-requests inbox UI
   * and approved-peers list land in phase 4b-2; the
   * pin-mismatch / peer-revoked alert reshape lands in 4b-4.
   * Each row carries its own inline description rather than a
   * section intro paragraph — matches the visual rhythm of
   * the Appearance / Editor sections (label + short desc +
   * control inline) and avoids the wall-of-text feel the
   * earlier intro paragraph had.
   */
  private _renderBuildServer() {
    return html`
      <div class="row">
        <div class="row-label">
          <span id="remote-build-enable-title" class="row-title">
            ${this._localize("settings.remote_build_enable")}
          </span>
          <span class="row-desc">
            ${this._localize("settings.remote_build_enable_desc")}
          </span>
        </div>
        <button
          class="toggle"
          role="switch"
          aria-labelledby="remote-build-enable-title"
          aria-checked=${this._remoteBuildEnabled}
          @click=${this._onToggleBuildServer}
        ></button>
      </div>

      ${this._renderApprovedPeers()}
      ${this._renderPeerRemoveConfirmDialog()}

      <div class="section-heading">
        ${this._localize("settings.build_server_card_heading")}
      </div>
      <div class="section-intro">
        ${this._localize("settings.build_server_card_desc")}
      </div>
      ${this._renderBuildServerCard()}

      ${this._renderCleanupTtlRow()}
    `;
  }

  /**
   * Pairing requests section.
   *
   * Lives as its own top-level Settings entry so the pairing
   * window's open/closed state is bound to the operator
   * actively viewing this screen. ``_selectSection`` opens the
   * window on enter and closes it on exit; the dialog's
   * ``@wa-after-hide`` handler closes the window if the
   * operator dismisses Settings while this section is active.
   * The status pill + countdown + Extend button next to the
   * heading communicate the open/closed state and remaining
   * lifetime more directly than prose, so no banner here.
   */
  private _renderPairingRequestsSection() {
    return html`
      ${this._renderPairingRequests()}
      <esphome-accept-peer-dialog
        @confirm=${this._onAcceptPeerConfirm}
        @reject=${this._onRejectPeerFromDialog}
      ></esphome-accept-peer-dialog>
    `;
  }

  /**
   * Destructive-confirm dialog for the APPROVED-row Remove path.
   *
   * PENDING-row Reject lives in
   * ``<esphome-accept-peer-dialog>`` instead, so this one is
   * Remove-only — no per-kind branching on the heading / body.
   */
  private _renderPeerRemoveConfirmDialog() {
    const prefix = "settings.build_server_peer_remove_confirm";
    return html`
      <esphome-confirm-dialog
        id="peer-remove-confirm"
        destructive
        heading=${this._localize(`${prefix}_title`)}
        message=${this._localize(`${prefix}_body`)}
        confirm-label=${this._localize(`${prefix}_confirm`)}
        @confirm=${this._onRemovePeerConfirm}
      ></esphome-confirm-dialog>
    `;
  }

  /**
   * Pairing requests inbox.
   *
   * Renders one row per PENDING ``StoredPeer`` the receiver
   * holds in its in-memory dict, plus a header carrying the
   * pairing-window status pill (open / closed). Each row shows
   * the sender's label and From-IP only with a single Review
   * button; the dashboard_id and OOB fingerprint moved into
   * ``<esphome-accept-peer-dialog>`` where the operator does the
   * side-by-side comparison. Both Accept and Reject live in that
   * dialog; the Reject path no longer routes through the shared
   * confirm-dialog (the dialog itself is the confirmation step).
   *
   * The empty-state message changes depending on window state:
   * "no requests yet" when the window is open (admin is waiting
   * for an offloader to connect); "open the window to receive
   * pair requests" when closed (something blocked
   * ``setRemoteBuildPairingWindow({open:true})`` on section
   * enter).
   */
  private _renderPairingRequests() {
    const peers = this._buildServerPeers;
    const pending = peers?.filter((p) => p.status === "pending") ?? [];
    return html`
      <div class="section-heading">
        ${this._localize("settings.build_server_pairing_requests_heading")}
        ${this._renderPairingWindowStatus()}
      </div>
      <div class="section-intro">
        ${this._localize("settings.build_server_pairing_requests_desc")}
      </div>
      ${peers === null
        ? html`
            <div class="row" role="status">
              <div class="row-label">
                <span class="row-desc">
                  ${this._localize(
                    "settings.build_server_pairing_requests_loading"
                  )}
                </span>
              </div>
            </div>
          `
        : pending.length === 0
          ? html`
              <div class="row" role="status">
                <div class="row-label">
                  <span class="row-desc">
                    ${this._localize(
                      "settings.build_server_pairing_requests_empty"
                    )}
                  </span>
                </div>
              </div>
            `
          : pending.map((p) => this._renderPendingPeerRow(p))}
    `;
  }

  /**
   * Status pill + countdown + Extend button next to the Pairing
   * requests heading.
   *
   * Mirrors what the backend's
   * ``remote_build_pairing_window_changed`` event reported. The
   * pill is rendered as a sibling to the heading text so the
   * operator sees "Pairing requests · Open · 4:32 · Extend" at
   * a glance. The countdown is derived from the anchor +
   * baseline captured on the most recent
   * ``remote_build_pairing_window_changed`` event and updates at
   * 1Hz between server events via the local
   * ``_pairingTick`` re-render nudge; the Extend button re-issues
   * ``setRemoteBuildPairingWindow({open: true})`` to bump the
   * idle deadline so a longer verification conversation doesn't
   * silently time out. Hidden when state is null (settings
   * dialog hasn't opened the section yet, or the section has
   * just been entered and the first event hasn't landed).
   */
  private _renderPairingWindowStatus() {
    const state = this._buildServerPairingWindowState;
    if (state === null) return nothing;
    if (!state.open) {
      return html`
        <span class="pairing-window-pill pairing-window-closed">
          ${this._localize("settings.build_server_pairing_window_closed")}
        </span>
      `;
    }
    const remaining = this._pairingRemainingSeconds();
    return html`
      <span class="pairing-window-pill pairing-window-open">
        ${this._localize("settings.build_server_pairing_window_open")}
      </span>
      ${remaining !== null
        ? html`
            <span
              class="pairing-window-countdown"
              aria-label=${this._localize(
                "settings.build_server_pairing_window_remaining_aria",
                { duration: this._formatPairingDuration(remaining) },
              )}
            >
              ${this._formatPairingDuration(remaining)}
            </span>
          `
        : nothing}
      <button
        type="button"
        class="pairing-window-extend"
        @click=${this._onExtendPairingWindow}
      >
        ${this._localize("settings.build_server_pairing_window_extend")}
      </button>
    `;
  }

  /**
   * Approved peers list: one row per ``status="approved"``
   * ``StoredPeer``. Each row carries the peer's label,
   * dashboard_id, paired-at relative time, and a Remove
   * button that routes through the same confirm-dialog as
   * Reject (both end in a ``removeRemoteBuildPeer`` call).
   */
  private _renderApprovedPeers() {
    const peers = this._buildServerPeers ?? [];
    const approved = peers.filter((p) => p.status === "approved");
    return html`
      <div class="section-heading">
        ${this._localize("settings.build_server_paired_senders_heading")}
      </div>
      <div class="section-intro">
        ${this._localize("settings.build_server_paired_senders_desc")}
      </div>
      ${this._buildServerPeers === null
        ? html`
            <div class="row" role="status">
              <div class="row-label">
                <span class="row-desc">
                  ${this._localize(
                    "settings.build_server_paired_senders_loading"
                  )}
                </span>
              </div>
            </div>
          `
        : approved.length === 0
          ? html`
              <div class="row" role="status">
                <div class="row-label">
                  <span class="row-desc">
                    ${this._localize(
                      "settings.build_server_paired_senders_empty"
                    )}
                  </span>
                </div>
              </div>
            `
          : approved.map((p) => this._renderApprovedPeerRow(p))}
    `;
  }

  private _renderPendingPeerRow(peer: PeerSummary) {
    return html`
      <div class="row peer-row peer-row-pending">
        <div class="row-label">
          <span class="row-title">${peer.label}</span>
          ${peer.peer_ip
            ? html`
                <span class="row-desc">
                  ${this._localize("settings.build_server_peer_ip_label")}
                  <code class="peer-ip">${peer.peer_ip}</code>
                </span>
              `
            : nothing}
        </div>
        <div class="peer-actions">
          <button
            type="button"
            aria-label=${this._localize(
              "settings.build_server_peer_review_aria",
              { label: peer.label }
            )}
            @click=${() => this._onAcceptPeerRequest(peer)}
          >
            ${this._localize("settings.build_server_peer_review")}
          </button>
        </div>
      </div>
    `;
  }

  private _renderApprovedPeerRow(peer: PeerSummary) {
    // Connection-state pill renders next to the label so the
    // operator sees at a glance whether the paired sender
    // currently has an active 5a-2 peer-link session. The
    // value is fed by ``RECEIVER_PEER_LINK_SESSION_OPENED`` /
    // ``_CLOSED`` events on app-shell, with the snapshot
    // (``initial_state.peers``) seeding the initial paint.
    const connectedClass = peer.connected
      ? "peer-connection-connected"
      : "peer-connection-disconnected";
    const connectedLabel = peer.connected
      ? this._localize("settings.build_server_peer_connected")
      : this._localize("settings.build_server_peer_disconnected");
    return html`
      <div class="row peer-row peer-row-approved">
        <div class="row-label">
          <span class="row-title">
            ${peer.label}
            <span class=${`peer-connection-pill ${connectedClass}`}>
              ${connectedLabel}
            </span>
          </span>
          <span class="row-desc">
            <code class="peer-dashboard-id">${peer.dashboard_id}</code>
          </span>
        </div>
        <button
          type="button"
          class="peer-remove"
          aria-label=${this._localize(
            "settings.build_server_peer_remove_aria",
            { label: peer.label }
          )}
          @click=${() => this._onRemovePeerRequest(peer.dashboard_id)}
        >
          ${this._localize("settings.build_server_peer_remove")}
        </button>
      </div>
    `;
  }

  /**
   * Offload role: this dashboard sending its compiles to
   * another dashboard on the network. Renders three blocks:
   *
   * 1. Paired build servers — the offloader-side pairings the
   *    user already authorised (PENDING + APPROVED). Each row
   *    shows the local label + receiver coords + a status
   *    pill, with an Unpair button per row.
   * 2. Known dashboards — mDNS-discovered build servers on the
   *    LAN. Each row gets a Pair button that opens the wizard
   *    pre-filled with the row's hostname only; the port stays
   *    at the wizard's 6055 default because the row's
   *    ``peer.port`` is the SRV-advertised dashboard HTTP port
   *    (6052), not the peer-link Noise WS port. Surfacing the
   *    receiver's actual peer-link port from the TXT
   *    ``remote_build_port`` key is a backend follow-up.
   * 3. Pair-by-hostname — the typed-hostname fallback for
   *    cross-subnet / non-mDNS receivers.
   *
   * Pairing-window + peer-link + scheduler land across phases
   * 4 / 5 / 7. The section's "still in development" signal
   * lives in the nav sidebar (this section is grouped under
   * the EXPERIMENTAL header, see SectionDef.group) rather
   * than as an inline banner at the top of the content pane —
   * lighter touch, doesn't push the actual settings down the
   * screen.
   */
  private _renderBuildOffload() {
    return html`
      ${this._renderOffloaderAlerts()}
      ${this._renderOffloaderRemoteBuildsToggle()}

      <div class="section-heading">
        ${this._localize("settings.paired_build_servers_heading")}
      </div>
      <div class="section-intro">
        ${this._localize("settings.paired_build_servers_desc")}
      </div>
      ${this._renderOffloaderPairings()}

      <div class="section-heading">
        ${this._localize("settings.remote_build_known_dashboards")}
      </div>
      ${this._renderRemoteBuildPeers()}

      <div class="section-heading">
        ${this._localize("settings.pair_build_server_section_heading")}
      </div>
      <div class="section-intro">
        ${this._localize("settings.pair_build_server_section_desc")}
      </div>
      <div class="row pair-build-server-row">
        <div class="row-label">
          <span class="row-desc">
            ${this._localize("settings.pair_build_server_row_helper")}
          </span>
        </div>
        <button
          class="btn-pair-build-server"
          type="button"
          @click=${this._onPairBuildServerClick}
        >
          ${this._localize("settings.pair_build_server_open_action")}
        </button>
      </div>
      <esphome-pair-build-server-dialog
        @pair-request-sent=${this._onPairRequestSent}
        @pair-approved=${this._onPairApproved}
        @pair-rejected=${this._onPairRejected}
      ></esphome-pair-build-server-dialog>
      <esphome-reauth-wizard-dialog
        @reauth-confirmed=${this._onReauthConfirmed}
      ></esphome-reauth-wizard-dialog>
      <esphome-remote-build-job-dialog></esphome-remote-build-job-dialog>
      <esphome-edit-pairing-endpoint-dialog></esphome-edit-pairing-endpoint-dialog>
      <esphome-confirm-dialog
        id="unpair-confirm"
        destructive
        heading=${this._localize("settings.unpair_confirm_title")}
        message=${this._unpairConfirmMessage()}
        confirm-label=${this._localize("settings.unpair_confirm_confirm")}
        @confirm=${this._onUnpairConfirm}
      ></esphome-confirm-dialog>
    `;
  }

  private _unpairConfirmMessage(): string {
    if (this._pendingUnpair === null) {
      return this._localize("settings.unpair_confirm_body");
    }
    return this._localize("settings.unpair_confirm_body_named", {
      label: this._pendingUnpair.label,
      hostname: trimTrailingDot(this._pendingUnpair.hostname),
      port: String(this._pendingUnpair.port),
    });
  }

  /**
   * Pin-mismatch / peer-revoked alert banners above the
   * paired-build-servers list.
   *
   * One row per entry in the offloader-alerts map — each
   * describes a broken pairing the operator needs to act on.
   * Alerts only clear via re-pair (the pair wizard auto-
   * resolves on success) or unpair (existing flow); there is
   * no Dismiss button. Re-pair opens the same wizard the
   * pair-with-a-new-receiver flow uses, pre-filled with both
   * the row's hostname AND port from the snapshot (the alert
   * carries the receiver coordinates the user originally
   * paired against, so we know the right peer-link port —
   * this is unlike the discovered-host Pair button which
   * has only the SRV port and falls back to the wizard's
   * 6055 default).
   *
   * Returns ``nothing`` when the alerts map is null (no
   * controller / still loading) or empty (no alerts), so the
   * Send-builds section's banner area collapses cleanly when
   * there's nothing broken.
   */
  private _renderOffloaderAlerts() {
    if (
      this._buildOffloadAlerts === null ||
      this._buildOffloadAlerts.size === 0
    ) {
      return nothing;
    }
    return Array.from(this._buildOffloadAlerts.values()).map((alert) =>
      this._renderOffloaderAlert(alert),
    );
  }

  private _renderOffloaderAlert(alert: OffloaderAlertSnapshotEntry) {
    const target = `${alert.receiver_hostname}:${alert.receiver_port}`;
    if (alert.kind === "pin_mismatch") {
      return html`
        <div class="offloader-alert offloader-alert-pin-mismatch" role="alert">
          <div class="offloader-alert-body">
            <div class="offloader-alert-title">
              ${this._localize("settings.offloader_alert_pin_mismatch_title", {
                label: alert.receiver_label,
              })}
            </div>
            <div class="offloader-alert-desc">
              ${this._localize("settings.offloader_alert_pin_mismatch_desc", {
                label: alert.receiver_label,
                target,
              })}
            </div>
          </div>
          <div class="offloader-alert-actions">
            <button
              type="button"
              class="btn-pair-build-server"
              aria-label=${this._localize(
                "settings.offloader_alert_repair_aria",
                { label: alert.receiver_label },
              )}
              @click=${() => this._onAlertRepair(alert)}
            >
              ${this._localize("settings.offloader_alert_repair_action")}
            </button>
            <button
              type="button"
              class="btn-unpair"
              aria-label=${this._localize(
                "settings.offloader_alert_unpair_aria",
                { label: alert.receiver_label },
              )}
              @click=${() => this._onAlertUnpair(alert)}
            >
              ${this._localize("settings.unpair_action")}
            </button>
          </div>
        </div>
      `;
    }
    return html`
      <div class="offloader-alert offloader-alert-peer-revoked" role="alert">
        <div class="offloader-alert-body">
          <div class="offloader-alert-title">
            ${this._localize("settings.offloader_alert_peer_revoked_title", {
              label: alert.receiver_label,
            })}
          </div>
          <div class="offloader-alert-desc">
            ${this._localize("settings.offloader_alert_peer_revoked_desc", {
              label: alert.receiver_label,
              target,
            })}
          </div>
        </div>
        <div class="offloader-alert-actions">
          <button
            type="button"
            class="btn-unpair"
            aria-label=${this._localize(
              "settings.offloader_alert_unpair_aria",
              { label: alert.receiver_label },
            )}
            @click=${() => this._onAlertUnpair(alert)}
          >
            ${this._localize("settings.unpair_action")}
          </button>
        </div>
      </div>
    `;
  }

  private _onAlertRepair = (
    alert: OffloaderAlertSnapshotEntry,
  ): void => {
    // Pin-mismatch alerts route through the re-auth wizard
    // (8a): the operator needs the structured walk-through
    // before they commit to re-pairing against a freshly
    // observed identity. The wizard renders the
    // expected-vs-observed fingerprints, frames the two
    // possible causes (legitimate rotation vs impersonation),
    // and gates the Re-pair button on an OOB-verification
    // checkbox; on confirm it fires ``reauth-confirmed`` and
    // we open the existing pair wizard pre-filled below
    // (``_onReauthConfirmed``). A successful ``request_pair``
    // for the same coordinates auto-resolves the alert
    // backend-side (fires ``OFFLOADER_PAIR_ALERT_DISMISSED``);
    // app-shell catches that event and drops the row.
    //
    // Any future alert kind that grows a Re-pair affordance
    // can fall through to the legacy direct-open path until
    // we decide whether it needs its own wizard.
    if (alert.kind === "pin_mismatch") {
      this._reauthWizardDialog?.open(alert);
      return;
    }
    this._pairBuildServerDialog?.open({
      hostname: alert.receiver_hostname,
      port: alert.receiver_port,
    });
  };

  /** Re-auth wizard cleared the user's OOB-verification gate;
   *  hand off to the existing pair-build-server-dialog with
   *  the alert's hostname + port pre-filled, same shape the
   *  pre-wizard direct-open path used. */
  private _onReauthConfirmed = (
    e: CustomEvent<{ hostname: string; port: number }>,
  ): void => {
    this._pairBuildServerDialog?.open({
      hostname: e.detail.hostname,
      port: e.detail.port,
    });
  };

  private _onAlertUnpair = (
    alert: OffloaderAlertSnapshotEntry,
  ): void => {
    // Route through the same destructive-confirm dialog the
    // paired-row Unpair button uses. ``unpair`` succeeding
    // backend-side auto-clears the alert (same
    // ``OFFLOADER_PAIR_ALERT_DISMISSED`` event path).
    this._pendingUnpair = {
      pin_sha256: alert.pin_sha256,
      hostname: alert.receiver_hostname,
      port: alert.receiver_port,
      label: alert.receiver_label,
    };
    this._unpairConfirmDialog?.open();
  };

  /**
   * 7b — master "Remote builds enabled" switch.
   *
   * The dashboard-wide kill-switch for transparent install
   * auto-routing. Default `true` matches the pre-7b semantic
   * (any APPROVED + connected + idle pairing was eligible);
   * flipping to `false` short-circuits ``pick_build_path`` to
   * LOCAL for every install while leaving the peer-link
   * sessions open and the Send-builds power-user dialog
   * working — operator says "keep the pairings, just stop
   * auto-routing for now."
   *
   * Renders a loading placeholder while the
   * ``subscribe_events`` snapshot hasn't seeded the value
   * yet. We do NOT default-render the switch as
   * ``aria-checked=true`` during loading: if the backend
   * value lands as `false` the switch would briefly announce
   * to screen readers as checked before flipping. Matches
   * the loading-row pattern already used by
   * ``_renderOffloaderPairings``.
   */
  private _renderOffloaderRemoteBuildsToggle() {
    if (this._offloaderRemoteBuildsEnabled === null) {
      return html`
        <div class="row" role="status">
          <div class="row-label">
            <span class="row-title">
              ${this._localize("settings.offloader_remote_builds_enabled")}
            </span>
            <span class="row-desc">
              ${this._localize(
                "settings.offloader_remote_builds_enabled_loading",
              )}
            </span>
          </div>
        </div>
      `;
    }
    return html`
      <div class="row">
        <div class="row-label">
          <span
            id="offloader-remote-builds-enabled-title"
            class="row-title"
          >
            ${this._localize("settings.offloader_remote_builds_enabled")}
          </span>
          <span class="row-desc">
            ${this._localize("settings.offloader_remote_builds_enabled_desc")}
          </span>
        </div>
        <button
          class="toggle"
          role="switch"
          aria-labelledby="offloader-remote-builds-enabled-title"
          aria-checked=${this._offloaderRemoteBuildsEnabled}
          @click=${this._onToggleOffloaderRemoteBuilds}
        ></button>
      </div>
    `;
  }

  private _renderOffloaderPairings() {
    if (this._buildOffloadPairings === null) {
      return html`
        <div class="row" role="status">
          <div class="row-label">
            <span class="row-desc">
              ${this._localize("settings.paired_build_servers_loading")}
            </span>
          </div>
        </div>
      `;
    }
    if (this._buildOffloadPairings.size === 0) {
      return html`
        <div class="row" role="status">
          <div class="row-label">
            <span class="row-desc">
              ${this._localize("settings.paired_build_servers_empty")}
            </span>
          </div>
        </div>
      `;
    }
    return Array.from(this._buildOffloadPairings.values()).map((p) =>
      this._renderPairingRow(p),
    );
  }

  private _renderPairingRow(pairing: PairingSummary) {
    // One pill per row, picked to convey the most informative
    // state. APPROVED branches into three sub-states keyed off
    // the live connection-state fields from the backend:
    //
    //   * ``connected``: Connected (the steady state).
    //   * ``connecting``: Connecting… (the run loop is alive
    //     but no session is open right now — first attempt or
    //     reconnect-backoff cycle).
    //   * neither: Disconnected (the run loop is orphaned via
    //     pin_mismatch / superseded; operator's recovery is
    //     re-pair or unpair).
    //
    // PENDING reads as "Pending" — the offloader hasn't spawned
    // a peer-link client yet, so connection state isn't
    // meaningful.
    //
    // ``last_connect_error`` rides on the row when non-empty so
    // the operator sees the specific failure (e.g.
    // "ConnectionRefusedError: …") under the pill rather than
    // having to trawl logs for it. Live updates flow on
    // OFFLOADER_PEER_LINK_OPENED / _CLOSED; the
    // ``initial_state.pairings`` snapshot seeds the initial
    // paint.
    let pillClass: string;
    let pillLabel: string;
    if (pairing.status !== "approved") {
      pillClass = "pairing-status-pill pairing-status-pending";
      pillLabel = this._localize("settings.pairing_status_pending");
    } else if (pairing.connected) {
      pillClass = "peer-connection-pill peer-connection-connected";
      pillLabel = this._localize("settings.build_offload_pairing_connected");
    } else if (pairing.connecting) {
      pillClass = "peer-connection-pill peer-connection-connecting";
      pillLabel = this._localize("settings.build_offload_pairing_connecting");
    } else {
      pillClass = "peer-connection-pill peer-connection-disconnected";
      pillLabel = this._localize("settings.build_offload_pairing_disconnected");
    }
    return html`
      <div class="row peer-row pairing-row">
        <div class="row-label">
          <span class="row-title">
            ${pairing.label}
            <span class=${pillClass}>${pillLabel}</span>
          </span>
          <span class="row-desc">
            ${trimTrailingDot(pairing.receiver_hostname)}:${pairing.receiver_port}
          </span>
          ${pairing.status === "approved" && !pairing.connected && pairing.last_connect_error
            ? // Render the most recent failure as a sub-line on
              // any APPROVED row that isn't currently connected
              // — covers both Connecting… (operator wants to
              // know what's failing while the run loop retries)
              // and the orphan disconnected case (the message is
              // *the* diagnostic since the run loop won't
              // recover on its own). PENDING rows never carry a
              // last error, so the ``status === approved`` guard
              // is redundant against the empty-string check but
              // kept as a defence in depth.
              html`
                <span class="row-desc pairing-last-error" role="status">
                  ${this._localize("settings.build_offload_pairing_last_error", {
                    detail: pairing.last_connect_error,
                  })}
                </span>
              `
            : nothing}
          ${this._renderPairingVersionMismatch(pairing)}
        </div>
        ${pairing.status === "approved"
          ? html`
              <button
                class="toggle"
                role="switch"
                aria-label=${this._localize(
                  "settings.build_offload_pairing_enabled_aria",
                  { label: pairing.label },
                )}
                aria-checked=${pairing.enabled}
                title=${this._localize(
                  "settings.build_offload_pairing_enabled_title",
                )}
                @click=${() => this._onTogglePairingEnabled(pairing)}
              ></button>
            `
          : nothing}
        ${pairing.status === "approved" && pairing.connected
          ? html`
              <button
                type="button"
                class="btn-build-remote"
                aria-label=${this._localize(
                  "settings.remote_build_submit_aria",
                  { label: pairing.label },
                )}
                @click=${() => this._onBuildRemoteClick(pairing)}
              >
                ${this._localize("settings.remote_build_submit_action")}
              </button>
            `
          : nothing}
        ${this._renderViewRemoteBuildButton(pairing)}
        ${pairing.status === "approved"
          ? html`
              <button
                type="button"
                class="btn-edit-endpoint"
                aria-label=${this._localize(
                  "settings.edit_pairing_endpoint_aria",
                  { label: pairing.label },
                )}
                title=${this._localize(
                  "settings.edit_pairing_endpoint_aria",
                  { label: pairing.label },
                )}
                @click=${() => this._onEditPairingEndpointClick(pairing)}
              >
                <wa-icon library="mdi" name="pencil"></wa-icon>
              </button>
            `
          : nothing}
        <button
          type="button"
          class="peer-remove btn-unpair"
          aria-label=${this._localize("settings.unpair_aria", {
            label: pairing.label,
          })}
          @click=${() => this._onUnpairRequest(pairing)}
        >
          ${this._localize("settings.unpair_action")}
        </button>
      </div>
    `;
  }

  /** Per-row sub-line surfacing an esphome_version mismatch
   *  between the offloader's bundled version and the
   *  paired receiver's reported version. Helps the operator
   *  spot the case the dispatched compile will run against
   *  a different schema than the YAML was authored on —
   *  especially the cross-release (year+month) gap, which
   *  is what the future scheduler's
   *  allow-major-version-mismatch toggle will key on (7a-3
   *  + 7b). PENDING rows skip the line: the handshake-time
   *  ``esphome_version`` capture only happens once the
   *  receiver has accepted the pair, so PENDING rows always
   *  carry an empty value the helper classifies as
   *  unknown. Connection-state (connected / connecting /
   *  disconnected) doesn't gate this — a long-disconnected
   *  pairing still carries the version we captured at the
   *  last handshake, and that version mismatch is still the
   *  right thing to surface ahead of the next reconnect. */
  private _renderPairingVersionMismatch(pairing: PairingSummary) {
    if (pairing.status !== "approved") return nothing;
    const kind = classifyVersionMismatch(
      this._appVersion,
      pairing.esphome_version,
    );
    if (kind === null) return nothing;
    const key =
      kind === "release"
        ? "settings.build_offload_pairing_version_mismatch_release"
        : "settings.build_offload_pairing_version_mismatch_patch";
    return html`
      <span
        class=${`row-desc pairing-version-mismatch pairing-version-mismatch--${kind}`}
        role="status"
      >
        ${this._localize(key, {
          peer: pairing.esphome_version,
          local: this._appVersion,
        })}
      </span>
    `;
  }

  /** Render the "View build" affordance for a pairing row when
   *  the in-flight remote-build jobs map carries an entry for
   *  the row's pin. The dispatch dialog's openForJob() lands
   *  directly on the running view so the user can re-attach
   *  to a build they previously closed the dialog on (or see
   *  the last terminal result before the user dismisses it).
   *
   *  Pairing-disconnected rows still get this button: the
   *  job state lives client-side regardless of whether the
   *  peer-link is currently up; surfacing the last output of
   *  a build that finished before disconnect is the whole
   *  point of the deferred-dismiss behaviour. */
  private _renderViewRemoteBuildButton(pairing: PairingSummary) {
    const job = this._latestRemoteBuildJobForPin(pairing.pin_sha256);
    if (job === undefined) return nothing;
    return html`
      <button
        type="button"
        class="btn-view-remote-build"
        aria-label=${this._localize("settings.remote_build_view_aria", {
          label: pairing.label,
        })}
        @click=${() => this._onViewRemoteBuildClick(job.job_id)}
      >
        ${this._localize("settings.remote_build_view_action")}
      </button>
    `;
  }

  /** Pick the most-recently-started remote-build job for *pin*
   *  out of the in-flight jobs map, or undefined if there are
   *  no entries for the pin. ``started_at`` is stamped by the
   *  dispatch dialog's success bubble; events-only entries
   *  (events arrived before the ack landed) carry 0 and sort
   *  to the bottom — that's fine because they're rare and the
   *  re-attach path tolerates either ordering. */
  private _latestRemoteBuildJobForPin(
    pin_sha256: string,
  ): RemoteBuildJobState | undefined {
    if (this._buildOffloadJobs === null) return undefined;
    let best: RemoteBuildJobState | undefined;
    for (const job of this._buildOffloadJobs.values()) {
      if (job.pin_sha256 !== pin_sha256) continue;
      if (best === undefined || job.started_at > best.started_at) {
        best = job;
      }
    }
    return best;
  }

  private _onViewRemoteBuildClick = (job_id: string): void => {
    this._remoteBuildDialog?.openForJob(job_id);
  };

  private _onBuildRemoteClick = (pairing: PairingSummary): void => {
    this._remoteBuildDialog?.open({
      pin_sha256: pairing.pin_sha256,
      receiver_label: pairing.label,
    });
  };

  private _onEditPairingEndpointClick = (pairing: PairingSummary): void => {
    this._editPairingEndpointDialog?.open(pairing);
  };

  private _onUnpairRequest = (pairing: PairingSummary): void => {
    this._pendingUnpair = {
      pin_sha256: pairing.pin_sha256,
      hostname: pairing.receiver_hostname,
      port: pairing.receiver_port,
      label: pairing.label,
    };
    this._unpairConfirmDialog?.open();
  };

  private _onUnpairConfirm = async (): Promise<void> => {
    const pending = this._pendingUnpair;
    this._pendingUnpair = null;
    if (this._api === undefined || pending === null) {
      return;
    }
    try {
      // 4a-o part 6 changed the WS arg from ``hostname / port``
      // to ``pin_sha256``; offloader-side state is keyed on the
      // receiver's stable cryptographic identity now.
      await this._api.unpairRemoteBuild({
        pin_sha256: pending.pin_sha256,
      });
    } catch (err) {
      // Log to the dashboard console for diagnostics; the
      // user-visible outcome is the same as the success path
      // (row drops on the bus event regardless), so a soft
      // toast on real errors is enough.
      console.warn("unpair failed:", err);
      this._toast("error", "settings.unpair_failed", { label: pending.label });
      return;
    }
    // Backend fires ``OFFLOADER_PAIR_STATUS_CHANGED`` with
    // ``status="removed"``; app-shell drops the row from the
    // pairings map automatically.
    this._toast("success", "settings.unpair_success", {
      label: pending.label,
    });
  };

  private _onPairApproved = (
    e: CustomEvent<{ hostname: string; port: number }>,
  ): void => {
    this._toast("success", "settings.pair_build_server_approved_toast", {
      hostname: e.detail.hostname,
      port: String(e.detail.port),
    });
  };

  private _onPairRejected = (
    e: CustomEvent<{ hostname: string; port: number }>,
  ): void => {
    this._toast("warning", "settings.pair_build_server_rejected_toast", {
      hostname: e.detail.hostname,
      port: String(e.detail.port),
    });
  };

  private _onPairBuildServerClick = (): void => {
    this._pairBuildServerDialog?.open();
  };

  private _onPairRequestSent = (
    e: CustomEvent<{ summary: PairingSummary }>,
  ): void => {
    // Surface a confirmation toast at the dialog-host level.
    // The dialog already shows the "open the receiver's
    // pairing requests page" copy on its sent step; this toast
    // is the breadcrumb the user sees after they close the
    // dialog so the action they took stays visible. App-shell
    // catches the same event (event bubbles past) and seeds
    // the new pending row into ``_buildOffloadPairings`` so
    // the dialog's auto-close watcher has a baseline.
    this._toast("success", "settings.pair_build_server_sent_toast", {
      hostname: e.detail.summary.receiver_hostname,
      port: String(e.detail.summary.receiver_port),
    });
  };

  private _renderBuildServerCard() {
    if (this._buildServerIdentityLoadFailed) {
      return html`
        <div class="row" role="alert">
          <div class="row-label">
            <span class="row-desc">
              ${this._localize("settings.remote_build_identity_load_failed")}
            </span>
          </div>
        </div>
      `;
    }
    if (this._buildServerIdentity === null) {
      return html`
        <div class="row" role="status">
          <div class="row-label">
            <span class="row-desc">
              ${this._localize("settings.remote_build_identity_loading")}
            </span>
          </div>
        </div>
      `;
    }
    const identity = this._buildServerIdentity;
    const formattedPin = formatPinSha256(identity.pin_sha256);
    return html`
      <div class="build-server-card">
        <div class="build-server-row build-server-row--pin">
          <span class="build-server-label">
            ${this._localize("settings.remote_build_pin_label")}
          </span>
          <div class="build-server-pin-display">
            <esphome-pin-emoji-grid
              .pin=${identity.pin_sha256}
            ></esphome-pin-emoji-grid>
            <details class="pin-hex">
              <summary>
                ${this._localize("settings.remote_build_pin_hex_summary")}
              </summary>
              <code class="build-server-pin">${formattedPin}</code>
            </details>
          </div>
        </div>
        <div class="build-server-actions">
          <button class="build-server-copy" type="button" @click=${this._onCopyPin}>
            ${this._localize("settings.remote_build_pin_copy")}
          </button>
          <span
            class=${`build-server-listener-badge build-server-listener-${
              identity.listener_bound ? "up" : "down"
            }`}
            role="status"
          >
            ${identity.listener_bound
              ? this._localize("settings.remote_build_listener_up")
              : this._localize("settings.remote_build_listener_down")}
          </span>
        </div>
        <div class="build-server-row">
          <span class="build-server-label">
            ${this._localize("settings.remote_build_dashboard_id_label")}
          </span>
          <code class="build-server-dashboard-id">${identity.dashboard_id}</code>
        </div>
        <div class="build-server-row build-server-versions">
          <span>
            ${this._localize("settings.remote_build_server_version_label")}
            <code>${identity.server_version}</code>
          </span>
          <span>
            ${this._localize("settings.remote_build_esphome_version_label")}
            <code>${identity.esphome_version}</code>
          </span>
        </div>
        <div class="build-server-actions">
          <button
            class="build-server-rotate"
            type="button"
            ?disabled=${this._buildServerRotateInFlight}
            @click=${this._onRotateRequest}
          >
            ${this._buildServerRotateInFlight
              ? this._localize("settings.remote_build_rotate_in_progress")
              : this._localize("settings.remote_build_rotate")}
          </button>
        </div>
      </div>
      <esphome-confirm-dialog
        id="rotate-confirm"
        destructive
        heading=${this._localize("settings.remote_build_rotate_confirm_title")}
        message=${this._localize("settings.remote_build_rotate_confirm_body")}
        confirm-label=${this._localize(
          "settings.remote_build_rotate_confirm_confirm"
        )}
        @confirm=${this._onRotateConfirm}
      ></esphome-confirm-dialog>
    `;
  }

  private _renderRemoteBuildPeers() {
    if (this._buildOffloadDiscoveredHosts === null) {
      return html`
        <div class="row" role="status">
          <div class="row-label">
            <span class="row-desc">
              ${this._localize("settings.remote_build_peers_loading")}
            </span>
          </div>
        </div>
      `;
    }
    // Hide hosts the user has already paired with — they're
    // listed in the "Paired build servers" section above with
    // their actual peer-link port and an Unpair affordance, so
    // also showing them here would just be confusing
    // duplication. ``_hasPairingFor`` does the case + trailing
    // dot normalisation so a discovered ``MyDashboard.local.``
    // row is correctly recognised as the same host as a
    // persisted ``mydashboard.local`` pairing.
    const peers = Array.from(this._buildOffloadDiscoveredHosts.values()).filter(
      (peer) => !this._hasPairingFor(peer.hostname),
    );
    if (peers.length === 0) {
      return html`
        <div class="row" role="status">
          <div class="row-label">
            <span class="row-desc">
              ${this._localize("settings.remote_build_peers_empty")}
            </span>
          </div>
        </div>
      `;
    }
    return peers.map((peer) => this._renderPeerRow(peer));
  }

  private _renderPeerRow(peer: RemoteBuildPeer) {
    const versionLine = peer.esphome_version
      ? this._localize("settings.remote_build_peer_version_line", {
          esphome: peer.esphome_version,
        })
      : nothing;
    // The Pair button pre-fills the hostname AND the peer-link
    // port. The row's ``peer.port`` is the dashboard's HTTP port
    // from the SRV record (default 6052), NOT the peer-link
    // Noise WS port (default 6055); the wizard wants the latter.
    // ``peer.remote_build_port`` carries that value off the mDNS
    // TXT ``remote_build_port`` key — non-zero whenever the
    // receiver's peer-link listener is bound, ``0`` for receivers
    // that haven't published it (default-off mode);
    // ``_onPairDiscoveredHost`` falls back to the wizard's 6055
    // default in the latter case. Already-paired hosts never
    // reach this renderer; ``_renderRemoteBuildPeers`` filters
    // them out one level up so the list is just unpaired
    // discovered hosts.
    return html`
      <div class="row peer-row">
        <div class="row-label">
          <span class="row-title">${trimTrailingDot(peer.name)}</span>
          <span class="row-desc">
            ${trimTrailingDot(peer.hostname)}:${peer.port} ${versionLine}
          </span>
        </div>
        <button
          type="button"
          class="btn-pair-build-server btn-pair-row"
          aria-label=${this._localize("settings.pair_build_server_row_aria", {
            name: trimTrailingDot(peer.name),
          })}
          @click=${() => this._onPairDiscoveredHost(peer)}
        >
          ${this._localize("settings.pair_build_server_row_action")}
        </button>
      </div>
    `;
  }

  private _hasPairingFor(hostname: string): boolean {
    const pairings = this._buildOffloadPairings;
    if (pairings === null || pairings.size === 0) {
      return false;
    }
    // Match on hostname only — the user could have paired the
    // same host on a non-default peer-link port. Compare via the
    // normalised form so case-drift between persisted pairings
    // (typically the dot-less ``mydashboard.local`` the user
    // typed into the wizard) and the freshly-discovered mDNS row
    // (typically ``MyDashboard.local.`` with mDNS's canonical
    // trailing dot) doesn't miss the dedupe.
    const target = normalizeHostnameForCompare(hostname);
    for (const pairing of pairings.values()) {
      if (normalizeHostnameForCompare(pairing.receiver_hostname) === target) {
        return true;
      }
    }
    return false;
  }

  private _onPairDiscoveredHost = (peer: RemoteBuildPeer): void => {
    // Pre-fill the wizard's port from the receiver's TXT
    // ``remote_build_port`` (the actual peer-link Noise WS port)
    // when present; ``0`` means the receiver hasn't published it
    // (peer-link listener unbound at announce time), so let the
    // wizard fall back to its 6055 default. Pre-filling the
    // SRV-advertised ``peer.port`` would land an ``UNAVAILABLE``
    // on the very first ``preview_pair`` round-trip — that's the
    // dashboard HTTP port, not the peer-link WS port.
    this._pairBuildServerDialog?.open({
      hostname: peer.hostname,
      port: peer.remote_build_port > 0 ? peer.remote_build_port : undefined,
    });
  };

  private _onThemeChange(e: Event) {
    const theme = (e.target as HTMLSelectElement).value;
    this._theme = theme;
    this.dispatchEvent(
      new CustomEvent("set-theme", {
        detail: theme,
        bubbles: true,
        composed: true,
      })
    );
  }

  private _onLanguageChange(e: Event) {
    const lang = (e.target as HTMLSelectElement).value as LanguageChoice;
    this._language = lang;
    this.dispatchEvent(
      new CustomEvent("set-language", {
        detail: lang,
        bubbles: true,
        composed: true,
      })
    );
  }

  private _onToggleDiff() {
    this.dispatchEvent(
      new CustomEvent("set-yaml-diff-button", {
        detail: !this._yamlDiffButton,
        bubbles: true,
        composed: true,
      })
    );
  }

  private _onToggleBuildServer() {
    this.dispatchEvent(
      new CustomEvent("set-remote-build-enabled", {
        detail: !this._remoteBuildEnabled,
        bubbles: true,
        composed: true,
      })
    );
  }

  /**
   * 7b — master "Remote builds enabled" switch click handler.
   *
   * Dispatches a custom event up to app-shell, which routes
   * the WS write through ``setOffloaderRemoteBuildSettings``
   * and rolls back the local state on failure (same shape as
   * ``set-remote-build-enabled``). The click is ignored when
   * the snapshot hasn't landed yet — the switch renders
   * disabled in that state to make the intent obvious.
   */
  private _onToggleOffloaderRemoteBuilds() {
    if (this._offloaderRemoteBuildsEnabled === null) {
      return;
    }
    this.dispatchEvent(
      new CustomEvent("set-offloader-remote-builds-enabled", {
        detail: !this._offloaderRemoteBuildsEnabled,
        bubbles: true,
        composed: true,
      })
    );
  }

  /**
   * 7b — per-row enable switch click handler.
   *
   * Identifies the row by ``pin_sha256`` (the wire-canonical
   * key the backend's ``_pairings`` dict is keyed on; receiver
   * hostname/port are display-only and can change without
   * remapping). App-shell routes the WS write through
   * ``setOffloaderPairingEnabled`` and rolls back on failure.
   */
  private _onTogglePairingEnabled(pairing: PairingSummary) {
    this.dispatchEvent(
      new CustomEvent("set-offloader-pairing-enabled", {
        detail: {
          pin_sha256: pairing.pin_sha256,
          enabled: !pairing.enabled,
        },
        bubbles: true,
        composed: true,
      })
    );
  }

  /**
   * Cache-cleanup TTL row.
   *
   * Renders the 6c knob as an hours input so operators don't
   * have to think in seconds. The backend stores seconds in
   * the canonical wire shape (matches the model field and
   * the WS validator's range); conversion lives at this seam.
   * Step + min + max constrain the keyboard / spinner; the
   * commit-on-change handler additionally clamps + only fires
   * the WS event when the value would actually change, so a
   * blur on the unchanged field isn't a redundant write.
   */
  private _renderCleanupTtlRow() {
    const hours = Math.round(this._remoteBuildCleanupTtl / 3600);
    const minHours = CLEANUP_TTL_MIN_SECONDS / 3600;
    const maxHours = CLEANUP_TTL_MAX_SECONDS / 3600;
    return html`
      <div class="row">
        <div class="row-label">
          <span id="remote-build-cleanup-ttl-title" class="row-title">
            ${this._localize("settings.remote_build_cleanup_ttl_title")}
          </span>
          <span class="row-desc">
            ${this._localize("settings.remote_build_cleanup_ttl_desc")}
          </span>
        </div>
        <div class="cleanup-ttl-input">
          <input
            id="remote-build-cleanup-ttl"
            class="cleanup-ttl-number"
            type="number"
            min=${minHours}
            max=${maxHours}
            step="1"
            aria-labelledby="remote-build-cleanup-ttl-title"
            .value=${String(hours)}
            @change=${this._onCommitCleanupTtl}
          />
          <span class="cleanup-ttl-unit">
            ${this._localize("settings.remote_build_cleanup_ttl_unit")}
          </span>
        </div>
      </div>
    `;
  }

  private _onCommitCleanupTtl = (e: Event): void => {
    // Parse the input as integer hours; reject NaN (the user
    // cleared the field then blurred) by reverting to the
    // current state's value. Clamp to [min, max] to mirror the
    // backend validator. Only dispatch when the resulting
    // seconds value differs from the current context value —
    // a blur on the unchanged field shouldn't fire a redundant
    // WS write.
    const input = e.target as HTMLInputElement;
    const hoursRaw = Number.parseInt(input.value, 10);
    const minHours = CLEANUP_TTL_MIN_SECONDS / 3600;
    const maxHours = CLEANUP_TTL_MAX_SECONDS / 3600;
    let hours: number;
    if (!Number.isFinite(hoursRaw)) {
      hours = Math.round(this._remoteBuildCleanupTtl / 3600) || (
        CLEANUP_TTL_DEFAULT_SECONDS / 3600
      );
    } else {
      hours = Math.max(minHours, Math.min(maxHours, hoursRaw));
    }
    input.value = String(hours);
    const seconds = hours * 3600;
    if (seconds === this._remoteBuildCleanupTtl) {
      return;
    }
    this.dispatchEvent(
      new CustomEvent<number>("set-remote-build-cleanup-ttl", {
        detail: seconds,
        bubbles: true,
        composed: true,
      })
    );
  };

}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-settings-dialog": ESPHomeSettingsDialog;
  }
}
