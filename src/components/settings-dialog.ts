import { consume } from "@lit/context";
import {
  mdiClose,
  mdiPaletteOutline,
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
  buildOffloadPairingsContext,
  buildServerIdentityRotationCounterContext,
  buildServerPairingWindowStateContext,
  buildServerPeersContext,
  localizeContext,
  remoteBuildEnabledContext,
  yamlDiffButtonContext,
} from "../context/index.js";
import { warningBannerStyles } from "../styles/banners.js";
import { dialogCloseButtonStyles } from "../styles/dialog-close-button.js";
import { espHomeStyles } from "../styles/shared.js";
import { formatPinSha256 } from "../util/cert-pin-format.js";
import { copyToClipboard } from "../util/copy-to-clipboard.js";
import { registerMdiIcons } from "../util/register-icons.js";
import "./confirm-dialog.js";
import type { ESPHomeConfirmDialog } from "./confirm-dialog.js";
import "./pair-build-server-dialog.js";
import type { ESPHomePairBuildServerDialog } from "./pair-build-server-dialog.js";

import "@home-assistant/webawesome/dist/components/dialog/dialog.js";
import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/option/option.js";
import "@home-assistant/webawesome/dist/components/select/select.js";

registerMdiIcons({
  close: mdiClose,
  "palette-outline": mdiPaletteOutline,
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
  | "build_offload";

interface SectionDef {
  id: Section;
  icon: string;
  labelKey: string;
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
    id: "build_server",
    icon: "server-network",
    labelKey: "settings.build_server",
  },
  {
    // "Send builds" = Offload role: this dashboard
    // dispatching its compiles to another dashboard.
    id: "build_offload",
    icon: "send-outline",
    labelKey: "settings.build_offload",
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

  // Pending Unpair confirmation: receiver coordinates of the
  // row whose Unpair button was clicked. Captured here so the
  // shared destructive-confirm dialog's @confirm handler knows
  // which row to drop. ``null`` when no Unpair is pending.
  @state()
  private _pendingUnpair: {
    hostname: string;
    port: number;
    label: string;
  } | null = null;

  // Phase 3c2b: receiver identity (cert pin + listener-bound + versions).
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
   * Pending destructive peer action — captured when the user
   * clicks Reject (PENDING peer) or Remove (APPROVED peer). The
   * shared ``<esphome-confirm-dialog>``'s heading / body /
   * confirm-label and the post-confirm toast keys both branch
   * on ``kind`` so the user sees Reject-specific copy on the
   * Reject path and Remove-specific copy on the Remove path
   * (the underlying WS call is the same in both cases).
   * ``null`` when no destructive action is pending.
   */
  @state()
  private _pendingPeerAction: {
    kind: "reject" | "remove";
    dashboardId: string;
  } | null = null;

  // Latest pairing-window state (open / closed / remaining
  // lifetime). ``null`` until the first event lands or the
  // section's ``setRemoteBuildPairingWindow`` opens it.
  @consume({ context: buildServerPairingWindowStateContext, subscribe: true })
  @state()
  private _buildServerPairingWindowState: PairingWindowState | null = null;

  @query("#rotate-confirm")
  private _rotateConfirmDialog!: ESPHomeConfirmDialog;

  @query("#peer-action-confirm")
  private _peerActionConfirmDialog!: ESPHomeConfirmDialog;

  @query("esphome-pair-build-server-dialog")
  private _pairBuildServerDialog!: ESPHomePairBuildServerDialog;

  @query("#unpair-confirm")
  private _unpairConfirmDialog!: ESPHomeConfirmDialog;

  @state()
  private _section: Section = "appearance";

  @state()
  private _theme: string = localStorage.getItem("esphome-theme") ?? "system";

  @state()
  private _language: LanguageChoice = readStoredLocale() ?? "system";

  @query("wa-dialog")
  private _dialog!: HTMLElement & { open: boolean };

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
    // context; nothing to reset here. The pending-action key
    // does need clearing — a stale value would mis-target the
    // confirm dialog on the next visit.
    this._pendingPeerAction = null;
    this._dialog.open = true;
  }

  close() {
    // If the user closed the dialog while the Build server
    // section was open, the pairing window is still open
    // server-side. Send the close-our-client tick so the
    // window's refcount drops; the receiver will auto-close
    // after the idle timeout regardless, but a prompt close is
    // less surprising. Fire-and-forget — the WS may already be
    // tearing down on the dashboard's own logout / navigation.
    if (this._section === "build_server" && this._api !== undefined) {
      void this._api
        .setRemoteBuildPairingWindow({ open: false })
        .catch(() => {
          // Ignore: dialog is closing; if the call failed the
          // receiver's idle timer cleans up.
        });
    }
    this._dialog.open = false;
  }

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
  }

  private _selectSection(section: Section) {
    const previousSection = this._section;
    this._section = section;
    // Leaving Build server: close the pairing window we opened
    // on entry (refcounted server-side; a graceful close drops
    // our client immediately rather than waiting on the 5min
    // idle timer). Fire-and-forget — the receiver's idle
    // cleanup is the safety net.
    if (
      previousSection === "build_server" &&
      section !== "build_server" &&
      this._api !== undefined
    ) {
      void this._api
        .setRemoteBuildPairingWindow({ open: false })
        .catch(() => {
          // Ignore: section change shouldn't block on a window
          // close failure; idle timer cleans up.
        });
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
      // Open the pairing window so ``intent="pair_request"``
      // Noise frames are accepted while the admin is on this
      // screen. Refcounted server-side; the receiver auto-closes
      // 5min after the most recent open/extend tick from any
      // client. The frontend doesn't periodically extend in this
      // PR — typical accept/reject sessions are well under 5min;
      // a follow-up can add activity-driven extends if user
      // workflows need longer.
      if (this._api !== undefined) {
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
   * Idempotent on the backend (``get_identity`` lazy-creates the
   * cert + key on first call but never rotates), so re-firing on
   * dialog re-open or after a rotate just refreshes the local
   * state. Tracks failure separately from the null-while-loading
   * state so the UI can render an explicit error message rather
   * than spinning forever.
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
   * Open the shared confirm-dialog for a destructive peer action.
   *
   * Same dialog instance is used for Reject (PENDING peer) and
   * Remove (APPROVED peer) — both end in a ``removePeer`` call —
   * but the heading / body / confirm-label and the post-confirm
   * toast keys are bound to ``kind`` so the user sees the right
   * copy on each path. The confirmed action lives in
   * :meth:`_onPeerActionConfirm`, which pulls
   * ``_pendingPeerAction`` for both the row id and the kind.
   */
  private _onPeerActionRequest(
    dashboardId: string,
    kind: "reject" | "remove"
  ) {
    this._pendingPeerAction = { kind, dashboardId };
    this._peerActionConfirmDialog?.open();
  }

  private async _onPeerActionConfirm() {
    const action = this._pendingPeerAction;
    this._pendingPeerAction = null;
    if (this._api === undefined || action === null) {
      return;
    }
    const toastPrefix =
      action.kind === "reject"
        ? "settings.build_server_peer_reject"
        : "settings.build_server_peer_remove";
    try {
      await this._api.removeRemoteBuildPeer({
        dashboard_id: action.dashboardId,
      });
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
    // ``REMOTE_BUILD_PAIR_STATUS_CHANGED`` with
    // ``status="removed"`` from the backend will drop the row
    // from the context-provided list automatically.
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

  private async _onRotateConfirm() {
    if (this._api === undefined || this._buildServerRotateInFlight) {
      return;
    }
    // Optimistic-update would be wrong here: a rotate hands
    // back a wholly new pin that the frontend can't predict
    // (it's the SHA-256 of the freshly-generated SPKI), so
    // there's nothing we can pre-fill. Just gate the button
    // on ``_buildServerRotateInFlight`` and toast the result.
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
    warningBannerStyles,
    dialogCloseButtonStyles,
    css`
      wa-dialog {
        --width: min(800px, 95vw);
      }

      wa-dialog::part(header) {
        background: var(--esphome-primary);
        /* Right padding is 0 so the 40x40 close button (sized via
           dialogCloseButtonStyles) sits flush with the dialog's
           corner. */
        padding: 0 0 0 var(--wa-space-m);
        height: 40px;
        box-sizing: border-box;
      }

      wa-dialog::part(title) {
        color: var(--esphome-on-primary);
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
      }

      wa-dialog::part(footer) {
        display: none;
      }

      wa-dialog::part(body) {
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

      /* Per-consumer spacing for warningBannerStyles' .warning-banner. */
      .warning-banner {
        margin: 0 0 var(--wa-space-m);
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
      <wa-dialog
        light-dismiss
        label="${this._localize("settings.title")} - ${this._localize(current.labelKey)}"
      >
        <div class="layout">
          <aside class="sidebar">
            <nav class="nav">
              ${SECTIONS.map(
                (s) => html`
                  <button
                    class="nav-item ${s.id === this._section ? "nav-item--active" : ""}"
                    @click=${() => this._selectSection(s.id)}
                  >
                    <wa-icon library="mdi" name=${s.icon}></wa-icon>
                    <span>${this._localize(s.labelKey)}</span>
                  </button>
                `
              )}
            </nav>
          </aside>
          <main class="content">
            <div class="content-body">${this._renderSection()}</div>
          </main>
        </div>
      </wa-dialog>
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
   * build-server identity card (cert fingerprint +
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

      <div class="section-heading">
        ${this._localize("settings.build_server_card_heading")}
      </div>
      <div class="section-intro">
        ${this._localize("settings.build_server_card_desc")}
      </div>
      ${this._renderBuildServerCard()}
      ${this._renderPairingRequests()}
      ${this._renderApprovedPeers()}
      ${this._renderPeerActionConfirmDialog()}
    `;
  }

  /**
   * Shared destructive-confirm dialog for Reject + Remove.
   *
   * Heading / body / confirm-label are derived from
   * ``_pendingPeerAction.kind`` so the user sees Reject-specific
   * copy on the Reject path and Remove-specific copy on the
   * Remove path. Defaults to the Remove copy when no action is
   * pending — the dialog is hidden in that state, so the
   * fallback is never visible; it just keeps the attribute
   * bindings non-empty between actions.
   */
  private _renderPeerActionConfirmDialog() {
    const kind = this._pendingPeerAction?.kind ?? "remove";
    const prefix =
      kind === "reject"
        ? "settings.build_server_peer_reject_confirm"
        : "settings.build_server_peer_remove_confirm";
    return html`
      <esphome-confirm-dialog
        id="peer-action-confirm"
        destructive
        heading=${this._localize(`${prefix}_title`)}
        message=${this._localize(`${prefix}_body`)}
        confirm-label=${this._localize(`${prefix}_confirm`)}
        @confirm=${this._onPeerActionConfirm}
      ></esphome-confirm-dialog>
    `;
  }

  /**
   * Pairing requests inbox.
   *
   * Renders one row per PENDING ``StoredPeer`` the receiver
   * holds in its in-memory dict, plus a header carrying the
   * pairing-window status pill (open / closed).
   * Each row shows label + offloader's pin + peer-IP for sanity-
   * check, with ``[Accept] [Reject]`` buttons. Reject routes
   * through the shared confirm-dialog (destructive).
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
   * Status pill next to the Pairing requests heading.
   *
   * Mirrors what the backend's
   * ``remote_build_pairing_window_changed`` event reported. The
   * pill is rendered as a sibling to the heading text so the
   * user sees "Pairing requests · Open · 4:32 left" at a
   * glance. Hidden when state is null (settings dialog hasn't
   * opened the section yet, or the section has just been
   * entered and the first event hasn't landed).
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
    return html`
      <span class="pairing-window-pill pairing-window-open">
        ${this._localize("settings.build_server_pairing_window_open")}
      </span>
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
    const formattedPin = formatPinSha256(peer.pin_sha256);
    return html`
      <div class="row peer-row peer-row-pending">
        <div class="row-label">
          <span class="row-title">${peer.label}</span>
          <span class="row-desc">
            <code class="peer-dashboard-id">${peer.dashboard_id}</code>
          </span>
          <span class="row-desc">
            <code class="peer-pin">${formattedPin}</code>
          </span>
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
            class="peer-approve"
            aria-label=${this._localize(
              "settings.build_server_peer_approve_aria",
              { label: peer.label }
            )}
            @click=${() => this._onApprovePeer(peer.dashboard_id)}
          >
            ${this._localize("settings.build_server_peer_approve")}
          </button>
          <button
            type="button"
            class="peer-reject"
            aria-label=${this._localize(
              "settings.build_server_peer_reject_aria",
              { label: peer.label }
            )}
            @click=${() =>
              this._onPeerActionRequest(peer.dashboard_id, "reject")}
          >
            ${this._localize("settings.build_server_peer_reject")}
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
          @click=${() =>
            this._onPeerActionRequest(peer.dashboard_id, "remove")}
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
   * 4 / 5 / 7; the in-section banner still says "not
   * implemented yet" because no compile job is actually
   * dispatched until phase 5+ wires the build session.
   */
  private _renderBuildOffload() {
    return html`
      <div class="warning-banner" role="status">
        ${this._localize("settings.build_offload_unimplemented_banner")}
      </div>

      ${this._renderOffloaderAlerts()}

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
      hostname: this._pendingUnpair.hostname,
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
    // Open the pair wizard pre-filled with the alert's
    // hostname AND port — the alert carries the exact
    // coordinates the user originally paired against, so the
    // peer-link port is known here (unlike the discovered-
    // host Pair flow which only has the SRV port). A
    // successful ``request_pair`` for the same coordinates
    // auto-resolves the alert backend-side (fires
    // ``OFFLOADER_PAIR_ALERT_DISMISSED``); app-shell catches
    // that event and drops the row from the alerts map, so
    // the alert disappears without any extra work here.
    this._pairBuildServerDialog?.open({
      hostname: alert.receiver_hostname,
      port: alert.receiver_port,
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
      hostname: alert.receiver_hostname,
      port: alert.receiver_port,
      label: alert.receiver_label,
    };
    this._unpairConfirmDialog?.open();
  };

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
    const statusKey =
      pairing.status === "approved"
        ? "settings.pairing_status_approved"
        : "settings.pairing_status_pending";
    const statusClass =
      pairing.status === "approved"
        ? "pairing-status-approved"
        : "pairing-status-pending";
    return html`
      <div class="row peer-row pairing-row">
        <div class="row-label">
          <span class="row-title">
            ${pairing.label}
            <span class=${`pairing-status-pill ${statusClass}`}>
              ${this._localize(statusKey)}
            </span>
          </span>
          <span class="row-desc">
            ${pairing.receiver_hostname}:${pairing.receiver_port}
          </span>
        </div>
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

  private _onUnpairRequest = (pairing: PairingSummary): void => {
    this._pendingUnpair = {
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
      await this._api.unpairRemoteBuild({
        hostname: pending.hostname,
        port: pending.port,
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
        <div class="build-server-row">
          <span class="build-server-label">
            ${this._localize("settings.remote_build_pin_label")}
          </span>
          <code class="build-server-pin">${formattedPin}</code>
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
    const peers = Array.from(this._buildOffloadDiscoveredHosts.values());
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
    // The Pair button pre-fills only the hostname. The row's
    // ``peer.port`` is the dashboard's HTTP port from the SRV
    // record (default 6052), not the peer-link Noise WS port
    // (default 6055) — pre-filling SRV port would land a
    // ``UNAVAILABLE`` on the very first preview round-trip.
    // Until the backend surfaces the receiver's peer-link
    // ``remote_build_port`` from TXT, the dialog falls back to
    // its 6055 default and the user can edit if the receiver
    // overrode ``--remote-build-port``.
    const alreadyPaired = this._hasPairingFor(peer.hostname);
    return html`
      <div class="row peer-row">
        <div class="row-label">
          <span class="row-title">${peer.name}</span>
          <span class="row-desc">
            ${peer.hostname}:${peer.port} ${versionLine}
          </span>
        </div>
        <button
          type="button"
          class="btn-pair-build-server btn-pair-row"
          ?disabled=${alreadyPaired}
          aria-label=${this._localize("settings.pair_build_server_row_aria", {
            name: peer.name,
          })}
          @click=${() => this._onPairDiscoveredHost(peer)}
        >
          ${alreadyPaired
            ? this._localize("settings.pair_build_server_row_already_paired")
            : this._localize("settings.pair_build_server_row_action")}
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
    // same host on a non-default peer-link port. The Pair
    // button on the row should still disable so the user can't
    // start a duplicate flow without first unpairing.
    for (const pairing of pairings.values()) {
      if (pairing.receiver_hostname === hostname) {
        return true;
      }
    }
    return false;
  }

  private _onPairDiscoveredHost = (peer: RemoteBuildPeer): void => {
    this._pairBuildServerDialog?.open({ hostname: peer.hostname });
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

}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-settings-dialog": ESPHomeSettingsDialog;
  }
}
