import { consume } from "@lit/context";
import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";

import type { ESPHomeAPI } from "../api/index.js";
import type { IdentityView, PairingSummary } from "../api/types/remote-build.js";
import type { LocalizeFunc } from "../common/localize.js";
import {
  apiContext,
  buildOffloadPairingsContext,
  localizeContext,
} from "../context/index.js";
import { dialogActionButtonStyles } from "../styles/dialog-action-buttons.js";
import { dialogChromeStyles } from "../styles/dialog-chrome.js";
import { inputStyles } from "../styles/inputs.js";
import { pinHexStyles } from "../styles/pin-hex.js";
import { espHomeStyles } from "../styles/shared.js";
import { friendlyHostname } from "../util/hostname.js";
import "./base-dialog.js";
import {
  onConfirmSubmit,
  onPreviewSubmit,
  watchPairingApproval,
} from "./pair-build-server-dialog/actions.js";
import {
  renderConfirmStep,
  renderInputStep,
  renderSentStep,
} from "./pair-build-server-dialog/renderers.js";
import { pairBuildServerDialogStyles } from "./pair-build-server-dialog/styles.js";
import "./pin-emoji-grid.js";

// Wizard for pairing this dashboard with a build server (receiver) the user
// types in by hand. Used when the receiver isn't reachable via mDNS
// (cross-subnet, different VLAN, container networks). The discovered-hosts
// list covers same-subnet; this is the typed-hostname fallback.
//
// Flow: input → preview_pair (Noise XX captures static X25519 pubkey)
//     → confirm (operator OOB-verifies pin_sha256 + sets labels)
//     → submitting → sent (terminal — receiver admin must Accept)
//
// Specific ErrorCode → copy:
//   UNAVAILABLE      → "Couldn't reach the receiver"
//   PRECONDITION_FAILED → "pin changed since you confirmed" (TOCTOU)
//   NO_PAIRING_WINDOW → "pairing window closed"
//   INVALID_ARGS     → "receiver rejected: {details}"
@customElement("esphome-pair-build-server-dialog")
export class ESPHomePairBuildServerDialog extends LitElement {
  @consume({ context: apiContext, subscribe: true }) @state() _api?: ESPHomeAPI;
  @consume({ context: localizeContext, subscribe: true })
  @state()
  _localize: LocalizeFunc = (key) => key;

  // Auto-close watcher: matches the offloader pairings row by pin_sha256
  // and closes on status→approved. removed → rejection toast + close.
  @consume({ context: buildOffloadPairingsContext, subscribe: true })
  @state()
  _buildOffloadPairings: Map<string, PairingSummary> | null = null;

  @state() _step: "input" | "confirm" | "sent" = "input";
  @state() _busy = false;
  @state() _hostname = "";
  @state() _port = "6055";
  @state() _previewedPin = "";
  @state() _receiverLabel = "";
  @state() _offloaderLabel = "";
  @state() _error: string | null = null;
  @state() _open = false;

  // Resets on open() so the next pair attempt re-derives from hostname.
  @state() _receiverLabelTouched = false;

  // ${hostname}:${port} of the submitted request — null outside the sent step.
  @state() _sentKey: string | null = null;

  // This dashboard's own stable identity (dashboard_id + pin_sha256). Shown on
  // the sent step so the operator can match it against what the receiver's
  // "Pairing request" dialog displays for this offloader. Loaded on open();
  // renderSentStep hides the whole identity card while this is null (load
  // still in flight or failed).
  @state() _offloaderIdentity: IdentityView | null = null;

  static styles = [
    espHomeStyles,
    inputStyles,
    pinHexStyles,
    dialogActionButtonStyles,
    // Neutral header + title + footer (shared) — dialog-chrome.ts.
    dialogChromeStyles,
    pairBuildServerDialogStyles,
  ];

  open(prefill?: { hostname?: string; port?: number }): void {
    this._step = "input";
    this._busy = false;
    this._hostname = prefill?.hostname ?? "";
    this._port = prefill?.port !== undefined ? String(prefill.port) : "6055";
    this._previewedPin = "";
    // Pre-fill labels from known hostnames. The offloader label is sourced
    // from window.location.hostname (the URL used to reach this dashboard)
    // and doesn't auto-update afterwards — the page can't reload mid-dialog
    // without losing form state anyway.
    this._receiverLabel = friendlyHostname(this._hostname);
    this._receiverLabelTouched = false;
    this._offloaderLabel = friendlyHostname(window.location.hostname);
    this._error = null;
    this._sentKey = null;
    this._offloaderIdentity = null;
    void this._loadOffloaderIdentity();
    this._open = true;
  }

  // Read this dashboard's own identity for the sent-step fingerprint. The
  // call is idempotent and lazy-creates the peer-link keypair on first use;
  // failures leave the card hidden rather than blocking the pair flow.
  private async _loadOffloaderIdentity(): Promise<void> {
    if (!this._api) return;
    try {
      this._offloaderIdentity = await this._api.getRemoteBuildIdentity();
    } catch {
      this._offloaderIdentity = null;
    }
  }

  close = (): void => {
    this._open = false;
  };

  private _onAfterHide = (): void => {
    // wa-dialog finished hiding (after Esc / outside-click / X). Flip the
    // local open flag so the next render's ?open binding matches.
    this._open = false;
  };

  protected willUpdate(changed: Map<string, unknown>): void {
    super.willUpdate(changed);
    watchPairingApproval(this, changed);
  }

  _onPreviewSubmit = () => onPreviewSubmit(this);
  _onConfirmSubmit = () => onConfirmSubmit(this);
  _onConfirmBack = (): void => {
    if (this._busy) return;
    // Drop captured pin — user is going back, possibly to a different host.
    // Re-previewing refills it on the next forward step.
    this._previewedPin = "";
    this._step = "input";
    this._error = null;
  };

  protected render() {
    // ?busy gates outside-click + Esc + close-button while a round-trip is
    // in flight. Base-dialog vetoes wa-hide when busy — without
    // this, a successful request_pair could fire pair-request-sent against
    // an already-closed dialog.
    return html`
      <esphome-base-dialog
        ?open=${this._open}
        ?busy=${this._busy}
        .label=${this._dialogTitle()}
        @after-hide=${this._onAfterHide}
      >
        ${this._renderStep()}
      </esphome-base-dialog>
    `;
  }

  private _dialogTitle(): string {
    if (this._step === "sent") {
      return this._localize("settings.pair_build_server_sent_title");
    }
    if (this._step === "confirm") {
      return this._localize("settings.pair_build_server_confirm_title");
    }
    return this._localize("settings.pair_build_server_input_title");
  }

  private _renderStep() {
    if (this._step === "input") return renderInputStep(this);
    if (this._step === "confirm") return renderConfirmStep(this);
    return renderSentStep(this);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-pair-build-server-dialog": ESPHomePairBuildServerDialog;
  }
}
