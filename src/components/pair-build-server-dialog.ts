import "@home-assistant/webawesome/dist/components/dialog/dialog.js";

import { consume } from "@lit/context";
import { LitElement, css, html, nothing } from "lit";
import { customElement, query, state } from "lit/decorators.js";

import type { ESPHomeAPI } from "../api/index.js";
import type { LocalizeFunc } from "../common/localize.js";
import { APIError } from "../api/api-error.js";
import { ErrorCode, type PairingSummary } from "../api/types.js";
import {
  apiContext,
  buildOffloadPairingsContext,
  localizeContext,
} from "../context/index.js";
import { inputStyles } from "../styles/inputs.js";
import { espHomeStyles } from "../styles/shared.js";
import { formatPinSha256 } from "../util/cert-pin-format.js";

/**
 * Wizard for pairing this dashboard with a build server (receiver)
 * the user types in by hand.
 *
 * Used when the receiver isn't reachable via mDNS — cross-subnet,
 * different VLAN, container networks where multicast doesn't
 * propagate, etc. The discovered-hosts list (from
 * ``subscribe_events.initial_state.hosts`` plus
 * ``REMOTE_BUILD_HOST_ADDED`` events) covers the same-subnet
 * case; this dialog is the typed-hostname fallback that replaces
 * the now-deleted manual-host save step.
 *
 * Flow:
 *
 * 1. **input** — operator enters ``hostname`` + ``port``. Submit
 *    runs ``preview_pair``, which opens a brief Noise XX WS to
 *    the receiver and captures its static X25519 pubkey. No
 *    state mutated server-side. Transport / handshake failures
 *    surface as ``UNAVAILABLE`` and bring the user back to the
 *    input step with the error inline.
 * 2. **confirm** — dialog shows the receiver's
 *    ``pin_sha256`` (the SHA-256 of the captured pubkey, formatted
 *    as space-separated byte pairs). Operator OOB-verifies the
 *    pin against what the receiver's Settings → Build server
 *    card displays. Two label inputs:
 *    * ``receiver_label`` — what the user calls *this* receiver
 *      locally. Lands on the offloader's
 *      ``StoredPairing.label``.
 *    * ``offloader_label`` — what *this* dashboard calls itself
 *      when introducing itself to the receiver. Lands in the
 *      receiver's Pairing requests inbox.
 * 3. **submitting** — ``request_pair`` round-trip in flight.
 * 4. **sent** — success terminal. Receiver's admin has to click
 *    Accept on their Pairing requests screen to complete the
 *    pairing; this dialog closes with a "request sent" toast and
 *    the row will land in the offloader-side pairings list with
 *    ``status: "pending"`` until the receiver flips it.
 *
 * Errors stay inline on the failing step — the operator can
 * retry without re-typing everything. Specific ``ErrorCode``s
 * map to specific copy:
 *
 * - ``UNAVAILABLE`` (preview / request) → "Couldn't reach the
 *   receiver at host:port."
 * - ``PRECONDITION_FAILED`` (request_pair) → "The receiver's
 *   pin changed since you confirmed it. Re-preview before
 *   pairing." (TOCTOU between preview and request — rare; the
 *   receiver rotated their identity in the gap.)
 * - ``NO_PAIRING_WINDOW`` (request_pair) → "The receiver's
 *   pairing window is closed. Ask the receiver admin to open
 *   their Settings → Pairing requests page first."
 * - ``INVALID_ARGS`` → "The receiver rejected the request:
 *   {details}." Backend's validator surfaces field-level
 *   reasons via ``details``; passing them through verbatim is
 *   reasonable here because the user can act on them
 *   ("hostname empty", "port out of range").
 *
 * Dispatches ``pair-request-sent`` on the success terminal so
 * a parent can trigger a follow-up toast or re-render its
 * pairings list.
 */
/** Strip the trailing ``.local`` / ``.local.`` mDNS suffix from
 *  *host* so the result reads as a friendly label. Returns the
 *  input unchanged if no suffix matches (IP literals, plain
 *  short names, manual entries that don't look like mDNS). Also
 *  trims surrounding whitespace and a trailing dot — typical
 *  mDNS hostnames are FQDN-shape with the root dot. */
function friendlyHostname(host: string): string {
  let s = host.trim();
  if (s.endsWith(".")) s = s.slice(0, -1);
  if (s.toLowerCase().endsWith(".local")) s = s.slice(0, -".local".length);
  return s;
}

@customElement("esphome-pair-build-server-dialog")
export class ESPHomePairBuildServerDialog extends LitElement {
  @consume({ context: apiContext, subscribe: true })
  @state()
  private _api?: ESPHomeAPI;

  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  /** Auto-close hook for the ``sent`` terminal step. Watches
   *  the offloader pairings map for the row matching this
   *  dialog's submitted ``${hostname}:${port}`` and auto-
   *  closes when its status flips to ``approved`` (the
   *  receiver admin clicked Accept). The receiver-side reject
   *  / unpair path drops the row via
   *  ``OFFLOADER_PAIR_STATUS_CHANGED status="removed"``; the
   *  dialog catches that case via ``willUpdate`` and surfaces a
   *  rejection toast before closing. */
  @consume({ context: buildOffloadPairingsContext, subscribe: true })
  @state()
  private _buildOffloadPairings: Map<string, PairingSummary> | null = null;

  @state()
  private _step: "input" | "confirm" | "sent" = "input";

  @state()
  private _busy = false;

  @state()
  private _hostname = "";

  @state()
  private _port = "6055";

  @state()
  private _previewedPin = "";

  @state()
  private _receiverLabel = "";

  /** True once the user has typed in the receiver-label field
   *  so we stop auto-deriving from the hostname. Resets on
   *  ``open()`` so the next pair attempt re-derives. */
  @state()
  private _receiverLabelTouched = false;

  @state()
  private _offloaderLabel = "";

  @state()
  private _error: string | null = null;

  @query("wa-dialog")
  private _dialog!: HTMLElement & { open: boolean };

  static styles = [
    espHomeStyles,
    inputStyles,
    css`
      wa-dialog {
        --width: 500px;
      }

      wa-dialog::part(header) {
        padding: var(--wa-space-l) var(--wa-space-l) var(--wa-space-s);
      }

      wa-dialog::part(title) {
        font-size: var(--wa-font-size-m);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-normal);
      }

      wa-dialog::part(close-button__base) {
        background: transparent;
        border: none;
        box-shadow: none;
      }

      wa-dialog::part(body) {
        padding: 0 var(--wa-space-l);
      }

      wa-dialog::part(footer) {
        display: none;
      }

      .description {
        font-size: var(--wa-font-size-s);
        color: var(--wa-color-text-quiet);
        padding-bottom: var(--wa-space-m);
      }

      .field {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-xs);
        padding-bottom: var(--wa-space-m);
      }

      .row {
        display: flex;
        gap: var(--wa-space-s);
        padding-bottom: var(--wa-space-m);
      }

      .row .field {
        flex: 1;
        padding-bottom: 0;
      }

      .field--port {
        flex: 0 0 110px;
      }

      label {
        font-size: var(--wa-font-size-xs);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-quiet);
      }

      .helper {
        font-size: var(--wa-font-size-xs);
        color: var(--wa-color-text-quiet);
        margin-top: var(--wa-space-2xs);
      }

      .pin-card {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-xs);
        padding: var(--wa-space-m);
        margin-bottom: var(--wa-space-m);
        background: var(--wa-color-surface-default);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        border-radius: var(--wa-border-radius-m);
      }

      .pin-card-label {
        font-size: var(--wa-font-size-xs);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-quiet);
      }

      .pin-card code {
        font-family: var(--wa-font-family-mono, monospace);
        font-size: var(--wa-font-size-xs);
        word-break: break-all;
      }

      .pin-card-target {
        font-family: var(--wa-font-family-mono, monospace);
        font-size: var(--wa-font-size-xs);
        color: var(--wa-color-text-quiet);
      }

      .actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--wa-space-s);
        padding: var(--wa-space-m) var(--wa-space-l) var(--wa-space-l);
      }

      .btn {
        padding: 8px 18px;
        border-radius: var(--wa-border-radius-m);
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
        font-family: inherit;
        cursor: pointer;
        border: none;
        transition: background 0.12s;
      }

      .btn--cancel {
        background: var(--wa-color-surface-lowered);
        color: var(--wa-color-text-normal);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
      }

      .btn--cancel:hover:not(:disabled) {
        background: var(--wa-color-surface-border);
      }

      .btn--primary {
        background: var(--esphome-primary);
        color: var(--esphome-on-primary);
      }

      .btn--primary:hover:not(:disabled) {
        background: color-mix(in srgb, var(--esphome-primary), black 10%);
      }

      .btn--primary:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .field-error {
        color: var(--esphome-error);
        font-size: var(--wa-font-size-xs);
        margin-top: var(--wa-space-2xs);
      }

      .step-error {
        color: var(--esphome-error);
        font-size: var(--wa-font-size-s);
        padding: var(--wa-space-s) 0;
      }

      .trust-warning {
        margin-bottom: var(--wa-space-m);
        padding: var(--wa-space-s) var(--wa-space-m);
        border-left: 3px solid var(--esphome-warning, #f59e0b);
        background: color-mix(
          in srgb,
          var(--esphome-warning, #f59e0b),
          transparent 90%
        );
        color: var(--wa-color-text-normal);
        font-size: var(--wa-font-size-s);
      }

      .sent-body {
        padding-bottom: var(--wa-space-m);
        font-size: var(--wa-font-size-s);
      }

      .sent-body code {
        font-family: var(--wa-font-family-mono, monospace);
        font-size: var(--wa-font-size-xs);
      }
    `,
  ];

  /** Open the dialog. Optional prefills land on the input
   *  step's hostname / port fields so a "Pair" click on a
   *  discovered-host row can skip retyping the address. The
   *  user can still edit either field before clicking
   *  Continue — the prefill is a starting point, not a lock. */
  open(prefill?: { hostname?: string; port?: number }): void {
    this._step = "input";
    this._busy = false;
    this._hostname = prefill?.hostname ?? "";
    this._port =
      prefill?.port !== undefined ? String(prefill.port) : "6055";
    this._previewedPin = "";
    // Pre-fill both labels with sensible defaults derived from
    // the hostnames we already know. The user can edit either
    // before submitting; ``_receiverLabelTouched`` gates the
    // reactive auto-fill on hostname-field input so manual
    // edits aren't clobbered. The offloader label is set once
    // here from ``window.location.hostname`` (the URL the user
    // typed to reach this dashboard); it doesn't auto-update
    // afterwards because the page can't reload mid-dialog
    // without losing the form state anyway.
    this._receiverLabel = friendlyHostname(this._hostname);
    this._receiverLabelTouched = false;
    this._offloaderLabel = friendlyHostname(window.location.hostname);
    this._error = null;
    // Reset the auto-close watch key from any prior open. Set
    // again on a successful ``request_pair`` once we know the
    // exact ``${hostname}:${port}`` the row landed under.
    this._sentKey = null;
    this._dialog.open = true;
  }

  close(): void {
    this._dialog.open = false;
  }

  /** Key the dialog watches for an auto-close approval after
   *  ``request_pair`` lands. Set to
   *  ``${hostname}:${port}`` of the submitted request; cleared
   *  on the next ``open()``. ``null`` outside the ``sent``
   *  step. Mirrors the backend's ``StoredPairing`` key
   *  (receiver coordinates the user typed). */
  @state()
  private _sentKey: string | null = null;

  protected willUpdate(changed: Map<string, unknown>): void {
    super.willUpdate(changed);
    // Auto-close on a matching ``OFFLOADER_PAIR_STATUS_CHANGED``
    // event reaching the offloader pairings map: the receiver
    // admin clicked Accept (status flipped to "approved"), or
    // the receiver rejected / dropped the row before we got an
    // approval (the row leaves the map entirely). Either
    // outcome is the operator's "I can stop watching the dialog
    // now" signal — surface a toast at the dialog level and
    // close.
    if (
      this._sentKey === null ||
      this._step !== "sent" ||
      !changed.has("_buildOffloadPairings")
    ) {
      return;
    }
    const row = this._buildOffloadPairings?.get(this._sentKey);
    if (row !== undefined && row.status === "approved") {
      this.dispatchEvent(
        new CustomEvent<{ hostname: string; port: number }>(
          "pair-approved",
          {
            detail: this._parseSentKey(this._sentKey),
            bubbles: true,
            composed: true,
          },
        ),
      );
      this._sentKey = null;
      this.close();
      return;
    }
    if (row === undefined && this._buildOffloadPairings !== null) {
      // Row went away before we got an approval — receiver
      // admin clicked Reject, OR the user clicked Unpair on
      // another tab, OR the receiver-side rotated identity
      // and the offloader's status listener task pushed a
      // ``removed`` event. The dialog can't tell which, but
      // the user-visible outcome is the same ("the request
      // didn't land"); fire a generic ``pair-rejected``
      // event for the parent toast.
      this.dispatchEvent(
        new CustomEvent<{ hostname: string; port: number }>(
          "pair-rejected",
          {
            detail: this._parseSentKey(this._sentKey),
            bubbles: true,
            composed: true,
          },
        ),
      );
      this._sentKey = null;
      this.close();
    }
  }

  private _parseSentKey(key: string): { hostname: string; port: number } {
    const idx = key.lastIndexOf(":");
    return {
      hostname: key.slice(0, idx),
      port: Number.parseInt(key.slice(idx + 1), 10),
    };
  }

  protected render() {
    // Gate ``light-dismiss`` while a ``preview_pair`` /
    // ``request_pair`` round-trip is in flight: outside-click /
    // Esc / close-button can't hide an error that's about to
    // surface, and (more importantly) can't dismiss the dialog
    // between submitting and the request completing — that race
    // would let a successful ``request_pair`` fire its
    // ``pair-request-sent`` event + success toast against an
    // already-closed dialog. ``@wa-request-close`` catches Esc /
    // close-button while ``light-dismiss`` only blocks
    // outside-click, so both gates are present (same shape as
    // ``adopt-dialog``).
    return html`
      <wa-dialog
        label=${this._dialogTitle()}
        ?light-dismiss=${!this._busy}
        @wa-request-close=${this._onRequestClose}
      >
        ${this._renderStep()}
      </wa-dialog>
    `;
  }

  private _onRequestClose = (e: Event): void => {
    if (this._busy) {
      e.preventDefault();
    }
  };

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
    if (this._step === "input") return this._renderInputStep();
    if (this._step === "confirm") return this._renderConfirmStep();
    return this._renderSentStep();
  }

  private _renderInputStep() {
    const portNum = Number.parseInt(this._port, 10);
    const portValid =
      Number.isFinite(portNum) && portNum >= 1 && portNum <= 65535;
    const canSubmit =
      !this._busy && this._hostname.trim().length > 0 && portValid;
    return html`
      <div class="description">
        ${this._localize("settings.pair_build_server_input_desc")}
      </div>
      <div class="row">
        <div class="field">
          <label for="pair-hostname"
            >${this._localize(
              "settings.pair_build_server_hostname_label",
            )}</label
          >
          <input
            id="pair-hostname"
            type="text"
            inputmode="url"
            autocomplete="off"
            spellcheck="false"
            ?disabled=${this._busy}
            placeholder=${this._localize(
              "settings.pair_build_server_hostname_placeholder",
            )}
            .value=${this._hostname}
            @input=${(e: Event) => {
              this._hostname = (e.target as HTMLInputElement).value;
              // Track the receiver label off the hostname until
              // the user manually edits it. Saves a redundant
              // type for the typical "name = host" case without
              // overwriting a deliberate edit.
              if (!this._receiverLabelTouched) {
                this._receiverLabel = friendlyHostname(this._hostname);
              }
              this._error = null;
            }}
          />
        </div>
        <div class="field field--port">
          <label for="pair-port"
            >${this._localize("settings.pair_build_server_port_label")}</label
          >
          <input
            id="pair-port"
            type="number"
            min="1"
            max="65535"
            ?disabled=${this._busy}
            .value=${this._port}
            @input=${(e: Event) => {
              this._port = (e.target as HTMLInputElement).value;
              this._error = null;
            }}
          />
        </div>
      </div>
      <div class="helper">
        ${this._localize("settings.pair_build_server_port_helper")}
      </div>
      ${this._error
        ? html`<div class="step-error" role="alert">${this._error}</div>`
        : nothing}
      <div class="actions">
        <button
          class="btn btn--cancel"
          ?disabled=${this._busy}
          @click=${this.close}
        >
          ${this._localize("layout.cancel")}
        </button>
        <button
          class="btn btn--primary"
          ?disabled=${!canSubmit}
          @click=${this._onPreviewSubmit}
        >
          ${this._busy
            ? this._localize("settings.pair_build_server_previewing")
            : this._localize("settings.pair_build_server_preview_action")}
        </button>
      </div>
    `;
  }

  private _renderConfirmStep() {
    const canSubmit =
      !this._busy &&
      this._receiverLabel.trim().length > 0 &&
      this._offloaderLabel.trim().length > 0;
    return html`
      <div class="description">
        ${this._localize("settings.pair_build_server_confirm_desc")}
      </div>
      <div class="pin-card">
        <span class="pin-card-label">
          ${this._localize("settings.pair_build_server_pin_label")}
        </span>
        <code>${formatPinSha256(this._previewedPin)}</code>
        <span class="pin-card-target">
          ${this._localize("settings.pair_build_server_target", {
            hostname: this._hostname,
            port: this._port,
          })}
        </span>
      </div>
      <div class="trust-warning" role="alert">
        ${this._localize("settings.pair_build_server_trust_warning")}
      </div>
      <div class="field">
        <label for="pair-receiver-label">
          ${this._localize("settings.pair_build_server_receiver_label_label")}
        </label>
        <input
          id="pair-receiver-label"
          type="text"
          autocomplete="off"
          ?disabled=${this._busy}
          .value=${this._receiverLabel}
          placeholder=${this._localize(
            "settings.pair_build_server_receiver_label_placeholder",
          )}
          @input=${(e: Event) => {
            this._receiverLabel = (e.target as HTMLInputElement).value;
            this._receiverLabelTouched = true;
            this._error = null;
          }}
        />
        <span class="helper">
          ${this._localize("settings.pair_build_server_receiver_label_helper")}
        </span>
      </div>
      <div class="field">
        <label for="pair-offloader-label">
          ${this._localize("settings.pair_build_server_offloader_label_label")}
        </label>
        <input
          id="pair-offloader-label"
          type="text"
          autocomplete="off"
          ?disabled=${this._busy}
          .value=${this._offloaderLabel}
          placeholder=${this._localize(
            "settings.pair_build_server_offloader_label_placeholder",
          )}
          @input=${(e: Event) => {
            this._offloaderLabel = (e.target as HTMLInputElement).value;
            this._error = null;
          }}
        />
        <span class="helper">
          ${this._localize("settings.pair_build_server_offloader_label_helper")}
        </span>
      </div>
      ${this._error
        ? html`<div class="step-error" role="alert">${this._error}</div>`
        : nothing}
      <div class="actions">
        <button
          class="btn btn--cancel"
          ?disabled=${this._busy}
          @click=${this._onConfirmBack}
        >
          ${this._localize("layout.back")}
        </button>
        <button
          class="btn btn--primary"
          ?disabled=${!canSubmit}
          @click=${this._onConfirmSubmit}
        >
          ${this._busy
            ? this._localize("settings.pair_build_server_sending")
            : this._localize("settings.pair_build_server_request_action")}
        </button>
      </div>
    `;
  }

  private _renderSentStep() {
    return html`
      <div class="sent-body">
        ${this._localize("settings.pair_build_server_sent_desc", {
          hostname: this._hostname,
          port: this._port,
        })}
      </div>
      <div class="actions">
        <button class="btn btn--primary" @click=${this.close}>
          ${this._localize("layout.close")}
        </button>
      </div>
    `;
  }

  private _onPreviewSubmit = async (): Promise<void> => {
    if (this._api === undefined || this._busy) return;
    const hostname = this._hostname.trim();
    const port = Number.parseInt(this._port, 10);
    if (!hostname || !Number.isFinite(port) || port < 1 || port > 65535) {
      this._error = this._localize(
        "settings.pair_build_server_input_invalid",
      );
      return;
    }
    this._busy = true;
    this._error = null;
    try {
      const response = await this._api.previewRemoteBuildPair({
        hostname,
        port,
      });
      this._previewedPin = response.pin_sha256;
      this._step = "confirm";
    } catch (err) {
      this._error = this._previewErrorMessage(err);
    } finally {
      this._busy = false;
    }
  };

  private _onConfirmBack = (): void => {
    if (this._busy) return;
    // Drop the captured pin — the user is going back to retype
    // the address, possibly to a different host. Re-previewing
    // refills it on the next forward step.
    this._previewedPin = "";
    this._step = "input";
    this._error = null;
  };

  private _onConfirmSubmit = async (): Promise<void> => {
    if (this._api === undefined || this._busy) return;
    const hostname = this._hostname.trim();
    const port = Number.parseInt(this._port, 10);
    const receiverLabel = this._receiverLabel.trim();
    const offloaderLabel = this._offloaderLabel.trim();
    if (!receiverLabel || !offloaderLabel) {
      this._error = this._localize(
        "settings.pair_build_server_label_required",
      );
      return;
    }
    this._busy = true;
    this._error = null;
    try {
      const summary = await this._api.requestRemoteBuildPair({
        hostname,
        port,
        pin_sha256: this._previewedPin,
        receiver_label: receiverLabel,
        offloader_label: offloaderLabel,
      });
      this._step = "sent";
      // Pin the key the auto-close watcher in ``willUpdate``
      // checks against the offloader pairings map. Built from
      // the response, NOT the form fields, because the backend
      // normalises hostname (lowercase via
      // ``_validate_hostname``) and that's the form
      // ``summary.receiver_hostname`` carries — which is what
      // app-shell's ``_onPairRequestSent`` keys the map on. A
      // user who types ``MacBook-Pro.local.`` would otherwise
      // build ``_sentKey`` mixed-case while the map landed
      // lowercase, the watcher's ``map.get(_sentKey)`` would
      // return undefined, and the dialog would mistake "row
      // arrived under the canonical key" for "row never landed
      // → rejected".
      this._sentKey = `${summary.receiver_hostname}:${summary.receiver_port}`;
      // Backend persists the new ``StoredPairing`` row but
      // doesn't fire ``OFFLOADER_PAIR_STATUS_CHANGED`` for the
      // create — only on subsequent status flips. Seed the row
      // into the offloader pairings map via ``pair-request-sent``
      // so the auto-close watcher has a baseline to flip from
      // (without it, the next event would arrive against an
      // empty map slot and the dialog would mistake "first
      // approval" for "row went away → rejection"). The
      // ``PairingSummary`` returned from ``request_pair`` is
      // the same shape the snapshot delivers.
      this.dispatchEvent(
        new CustomEvent<{ summary: PairingSummary }>("pair-request-sent", {
          detail: { summary },
          bubbles: true,
          composed: true,
        }),
      );
    } catch (err) {
      this._error = this._requestErrorMessage(err);
    } finally {
      this._busy = false;
    }
  };

  private _previewErrorMessage(err: unknown): string {
    if (err instanceof APIError) {
      if (err.errorCode === ErrorCode.UNAVAILABLE) {
        return this._localize("settings.pair_build_server_preview_unreachable", {
          hostname: this._hostname,
          port: this._port,
        });
      }
      if (err.errorCode === ErrorCode.INVALID_ARGS) {
        return this._localize("settings.pair_build_server_invalid_args", {
          details: err.details,
        });
      }
    }
    return this._localize("settings.pair_build_server_preview_failed");
  }

  private _requestErrorMessage(err: unknown): string {
    if (err instanceof APIError) {
      if (err.errorCode === ErrorCode.PRECONDITION_FAILED) {
        return this._localize("settings.pair_build_server_pin_changed");
      }
      if (err.errorCode === ErrorCode.NO_PAIRING_WINDOW) {
        return this._localize("settings.pair_build_server_no_window");
      }
      if (err.errorCode === ErrorCode.UNAVAILABLE) {
        return this._localize("settings.pair_build_server_request_unreachable", {
          hostname: this._hostname,
          port: this._port,
        });
      }
      if (err.errorCode === ErrorCode.INVALID_ARGS) {
        return this._localize("settings.pair_build_server_invalid_args", {
          details: err.details,
        });
      }
    }
    return this._localize("settings.pair_build_server_request_failed");
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-pair-build-server-dialog": ESPHomePairBuildServerDialog;
  }
}
