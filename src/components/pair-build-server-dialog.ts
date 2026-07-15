import "@home-assistant/webawesome/dist/components/spinner/spinner.js";

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
import { fullscreenMobileDialog } from "../styles/dialog-mobile.js";
import { inputStyles } from "../styles/inputs.js";
import { pinHexStyles } from "../styles/pin-hex.js";
import { espHomeStyles } from "../styles/shared.js";
import { EnterController } from "../util/enter-controller.js";
import { friendlyHostname, parsePortInput } from "../util/hostname.js";
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
  // Any round-trip in flight (preview or send): gates re-entry, the submit
  // button, and the inputs, and drives the progress label/spinner.
  @state() _busy = false;
  // The mutating request_pair send specifically. Only this vetoes dismissal
  // (base-dialog busy gate) — the read-only fingerprint preview must stay
  // cancellable, so a stale/offline discovered host doesn't trap the user.
  @state() _sending = false;
  @state() _hostname = "";
  @state() _port = "6055";
  @state() _previewedPin = "";
  @state() _receiverLabel = "";
  @state() _offloaderLabel = "";
  // One-time pairing key from a headless build server's console banner.
  @state() _pairingKey = "";
  // Set from the preview response: true when the receiver has an armed
  // key-gated bootstrap window, so the confirm step shows + requires the
  // key field. A normal dashboard receiver reports false and the field
  // stays hidden.
  @state() _pairingKeyRequired = false;
  @state() _error: string | null = null;
  @state() _open = false;

  // Resets on open() so the next pair attempt re-derives from hostname.
  @state() _receiverLabelTouched = false;

  // Mirrors _receiverLabelTouched for the offloader-label field. An
  // untouched prefill is sent as offloader_label_auto so the receiver's
  // UI may replace it with this dashboard's advertised friendly name.
  @state() _offloaderLabelTouched = false;

  // True when the confirm step was reached by auto-preview (mDNS-discovered
  // host), so the input step was never shown. Drives the confirm step's
  // secondary button: Cancel (close) rather than Back (to the skipped form).
  @state() _skippedInput = false;

  // Bumped on every open(). The dialog is a reused singleton and a dismissable
  // preview can still be in flight (offline host), so onPreviewSubmit captures
  // this and drops its result if a later open() superseded the session — else a
  // late preview would clobber the fresh session with a stale host/fingerprint.
  // Not reactive: it gates a write, it doesn't drive render.
  _previewGeneration = 0;

  // ${hostname}:${port} of the submitted request — null outside the sent step.
  @state() _sentKey: string | null = null;

  // This dashboard's own stable identity (dashboard_id + pin_sha256). Shown on
  // the sent step so the operator can match it against what the receiver's
  // "Pairing request" dialog displays for this offloader. Loaded on open();
  // renderSentStep hides the whole identity card while this is null (load
  // still in flight or failed).
  @state() _offloaderIdentity: IdentityView | null = null;

  // Enter submits the current step. This dialog stays open across input→confirm,
  // so it drives its own controller (rather than base-dialog's confirmOnEnter)
  // to add the held-Enter guard: without it a single held key would carry from
  // the input step straight through the confirm submit, sending the pair request
  // past the unreviewed pin fingerprint.
  private _enter = new EnterController(this, (e) => {
    if (e.repeat) return;
    this._enterAction()?.();
  });

  static styles = [
    espHomeStyles,
    inputStyles,
    pinHexStyles,
    dialogActionButtonStyles,
    pairBuildServerDialogStyles,
    // Full-screen sheet on mobile (overrides base-dialog's centered default;
    // the outer-tree ::part rule wins the cascade).
    fullscreenMobileDialog("esphome-base-dialog"),
  ];

  // autoPreview skips the hostname/port input step: when the host+port are
  // already known (mDNS-discovered dashboard), preview the fingerprint
  // immediately and land on the confirm step. A failed preview drops back to
  // the pre-filled input form (onPreviewSubmit's error branch).
  open(
    prefill?: { hostname?: string; port?: number; receiverLabel?: string },
    opts?: { autoPreview?: boolean }
  ): void {
    // Supersede any preview still in flight from a previous open().
    this._previewGeneration += 1;
    this._step = "input";
    this._busy = false;
    this._sending = false;
    this._hostname = prefill?.hostname ?? "";
    this._port = prefill?.port !== undefined ? String(prefill.port) : "6055";
    this._previewedPin = "";
    // Pre-fill the receiver label from the caller-supplied friendly_name,
    // falling back to one derived from the hostname. The offloader label is
    // sourced from window.location.hostname and doesn't auto-update afterwards.
    this._receiverLabel =
      prefill?.receiverLabel?.trim() || friendlyHostname(this._hostname);
    this._receiverLabelTouched = false;
    this._offloaderLabel = friendlyHostname(window.location.hostname);
    this._offloaderLabelTouched = false;
    this._pairingKey = "";
    this._pairingKeyRequired = false;
    this._error = null;
    this._sentKey = null;
    this._offloaderIdentity = null;
    this._skippedInput = false;
    void this._loadOffloaderIdentity();
    this._open = true;
    if (
      opts?.autoPreview &&
      this._api !== undefined &&
      this._hostname.trim() &&
      parsePortInput(this._port) !== null
    ) {
      this._step = "confirm";
      this._skippedInput = true;
      void onPreviewSubmit(this);
    }
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
    // Drop the typed one-time key so it doesn't linger in component state
    // or the hidden shadow-DOM input after the dialog closes (render() is
    // gated on _step, not _open, so the confirm step stays mounted).
    this._pairingKey = "";
  };

  private _onAfterHide = (): void => {
    // wa-dialog finished hiding (after Esc / outside-click / X). Flip the
    // local open flag so the next render's ?open binding matches.
    this._open = false;
    this._pairingKey = "";
  };

  protected willUpdate(changed: Map<string, unknown>): void {
    super.willUpdate(changed);
    watchPairingApproval(this, changed);
    if (changed.has("_open")) this._enter.set(this._open);
  }

  _onPreviewSubmit = () => onPreviewSubmit(this);
  _onConfirmSubmit = () => onConfirmSubmit(this);
  _onConfirmBack = (): void => {
    // Allowed during the read-only preview (connecting) so the user can bail on
    // a stale host; only blocked once the request_pair send is in flight.
    if (this._sending) return;
    // Drop captured pin — user is going back, possibly to a different host.
    // Re-previewing refills it on the next forward step.
    this._previewedPin = "";
    this._error = null;
    // Reached confirm straight from the discovered list — there's no input
    // step to return to, so dismiss back to that list instead of revealing the
    // skipped hostname form.
    if (this._skippedInput) {
      this.close();
      return;
    }
    this._step = "input";
  };

  protected render() {
    // ?busy gates outside-click + Esc + close-button while the request_pair
    // send is in flight (so a successful send can't fire pair-request-sent
    // against an already-closed dialog). The read-only preview deliberately
    // does NOT veto dismissal — it has no side effect to orphan, and trapping
    // the user behind a spinner for an unreachable host is worse.
    return html`
      <esphome-base-dialog
        ?open=${this._open}
        ?busy=${this._sending}
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

  // Enter submits the current step; the read-only "sent" step has no action.
  // Each handler self-guards on its own validity (empty hostname, labels).
  private _enterAction(): (() => void) | undefined {
    if (this._step === "input") return this._onPreviewSubmit;
    if (this._step === "confirm") return this._onConfirmSubmit;
    return undefined;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-pair-build-server-dialog": ESPHomePairBuildServerDialog;
  }
}
