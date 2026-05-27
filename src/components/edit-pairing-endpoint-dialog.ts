import { consume } from "@lit/context";
import { LitElement, css, html, nothing } from "lit";
import { customElement, query, state } from "lit/decorators.js";

import type { ESPHomeAPI } from "../api/index.js";
import { APIError } from "../api/api-error.js";
import { ErrorCode, type PairingSummary } from "../api/types.js";
import type { LocalizeFunc } from "../common/localize.js";
import { apiContext, localizeContext } from "../context/index.js";
import { inputStyles } from "../styles/inputs.js";
import { espHomeStyles } from "../styles/shared.js";
import {
  normalizeHostnameForCompare,
  parsePortInput,
  trimTrailingDot,
} from "../util/hostname.js";
import { renderErrorBanner } from "../util/render-error.js";

import "./base-dialog.js";

/**
 * Edit a paired build server's hostname / port without re-pairing.
 *
 * Frontend-only fallback for the cases the 4a-o part 7 mDNS
 * auto-rebind can't catch: cross-subnet receivers (no mDNS
 * path), mDNS disabled on the receiver's host, the receiver
 * moved to a hostname the offloader's network can resolve but
 * mDNS doesn't broadcast.
 *
 * Two inputs (hostname + port). Save fires
 * ``remote_build/edit_pairing_endpoint`` against the existing
 * pairing's pin; backend runs a one-shot
 * ``peer_link_preview_pair`` probe and only commits the new
 * coords when the probe answers with the same pin the row was
 * paired against. Identity-mismatch refuses the edit and
 * surfaces the diagnostic inline — substituting a fresh pubkey
 * under the user's existing trust is the case 8a's re-auth
 * wizard exists specifically to gate.
 *
 * No preview step / no pin re-verify: the pin is unchanged on
 * the matching path, and a mismatch is a typed error not a
 * "did the pin drift?" branch. Operator's recovery is
 * Re-pair through the regular flow if they actually want to
 * accept the new identity.
 */
@customElement("esphome-edit-pairing-endpoint-dialog")
export class ESPHomeEditPairingEndpointDialog extends LitElement {
  @consume({ context: apiContext, subscribe: true })
  @state()
  private _api?: ESPHomeAPI;

  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @state() private _open = false;
  @state() private _pinSha256 = "";
  @state() private _label = "";
  @state() private _hostname = "";
  /** Port held as a string so an empty input stays empty
   *  while the user is mid-edit; parsed to a number only at
   *  validate / Save time. Mirrors ``pair-build-server-dialog``'s
   *  shape — coercing ``""`` back to ``0`` on every input event
   *  re-renders the field while the user is still typing. */
  @state() private _port = "";
  @state() private _initialHostname = "";
  @state() private _initialPort = "";
  @state() private _submitting = false;
  @state() private _errorMessage = "";

  @query("input[name='hostname']") private _hostInput?: HTMLInputElement;

  /** Open the dialog targeting *pairing*. Hostname / port
   *  inputs pre-fill with the row's current coords; the user
   *  edits whichever they need to and Saves. The pin is
   *  captured locally so a concurrent ``unpair`` between open
   *  and Save raises ``NOT_FOUND`` cleanly rather than
   *  attempting to mutate state the controller no longer
   *  knows. */
  open(pairing: PairingSummary): void {
    this._pinSha256 = pairing.pin_sha256;
    this._label = pairing.label;
    // Render with the trailing dot stripped — a typo-prone
    // FQDN-form like ``desktop.local.`` reads as
    // ``desktop.local`` in the dashboard's host-display
    // convention. Backend's ``_validate_hostname`` accepts
    // both forms, so the user can edit either way; the
    // ``_isUnchanged`` no-op check normalises both sides
    // through ``normalizeHostnameForCompare`` so re-typing
    // the same coords with a trailing dot or different case
    // is correctly recognised as unchanged.
    this._hostname = trimTrailingDot(pairing.receiver_hostname);
    this._port = String(pairing.receiver_port);
    this._initialHostname = this._hostname;
    this._initialPort = this._port;
    this._submitting = false;
    this._errorMessage = "";
    this._open = true;
    // Autofocus the hostname field on next paint. ``_open``
    // gates the whole render tree, so the input doesn't
    // exist until ``updateComplete`` fires.
    void this.updateComplete.then(() => {
      this._hostInput?.focus();
      this._hostInput?.select();
    });
  }

  private _close = () => {
    if (!this._open) return;
    this._open = false;
    this._errorMessage = "";
  };

  private _onHostnameInput = (e: Event) => {
    this._hostname = (e.target as HTMLInputElement).value;
  };

  private _onPortInput = (e: Event) => {
    // Stored as a string so an empty / partial edit
    // (clearing the field, or typing one digit at a time)
    // doesn't snap to ``0`` mid-edit. Validator parses on
    // the way out via ``_portValid`` / ``_onSave``.
    this._port = (e.target as HTMLInputElement).value;
  };

  private _onSave = async () => {
    if (this._api === undefined) return;
    if (this._submitting) return;
    const port = parsePortInput(this._port);
    if (port === null) return;
    const hostname = this._hostname.trim();
    this._errorMessage = "";
    this._submitting = true;
    try {
      await this._api.editRemoteBuildPairingEndpoint({
        pin_sha256: this._pinSha256,
        hostname,
        port,
      });
      // Backend mutates StoredPairing in place + fires
      // OFFLOADER_PAIR_ENDPOINT_REBOUND; the pairings-context
      // subscriber on app-shell upserts the row from the
      // event so this dialog doesn't have to write the
      // returned PairingSummary into state itself. Just
      // close.
      this.dispatchEvent(
        new CustomEvent("pairing-endpoint-edited", {
          bubbles: true,
          composed: true,
          detail: {
            pin_sha256: this._pinSha256,
            hostname,
            port,
          },
        })
      );
      this._open = false;
    } catch (err) {
      // Pass the values that actually went on the wire (trimmed
      // hostname + parsed port) into the formatter so the
      // UNAVAILABLE message shows the user the same coords the
      // request attempted, not whatever raw state happens to
      // be in the input fields right now.
      this._errorMessage = this._formatError(err, hostname, port);
    } finally {
      this._submitting = false;
    }
  };

  private _formatError(err: unknown, host: string, port: number): string {
    if (err instanceof APIError) {
      switch (err.errorCode) {
        case ErrorCode.UNAVAILABLE:
          return this._localize("settings.edit_pairing_endpoint_unavailable", {
            host,
            port: String(port),
          });
        case ErrorCode.PRECONDITION_FAILED:
          // Backend folds four distinct preconditions onto this
          // code: not-APPROVED, identity-not-loaded, no-op
          // edit, pin-mismatch at the new coords. Pin-mismatch
          // is the only one with operator-actionable detail
          // (re-pair through the regular flow); the others are
          // transient or UI-bug shapes the user would only see
          // mid-startup or after typoing the same coords back.
          // Detail string carries the diagnostic verbatim from
          // the backend; the dialog surfaces it inline so the
          // user sees which precondition tripped.
          return this._localize("settings.edit_pairing_endpoint_precondition_failed", {
            detail: err.details,
          });
        case ErrorCode.NOT_FOUND:
          return this._localize("settings.edit_pairing_endpoint_not_found");
        case ErrorCode.INVALID_ARGS:
          return this._localize("settings.edit_pairing_endpoint_invalid_args", {
            detail: err.details,
          });
        default:
          return this._localize("settings.edit_pairing_endpoint_generic_error");
      }
    }
    return this._localize("settings.edit_pairing_endpoint_generic_error");
  }

  private _onRequestClose = (e: Event): void => {
    // Gate light-dismiss / close while the WS round-trip is
    // in flight so a dismiss between Save and the ack returning
    // can't orphan the response. Same shape the dispatch
    // dialog uses.
    if (this._submitting) e.preventDefault();
  };

  private _hostnameValid(): boolean {
    return this._hostname.trim().length > 0;
  }

  private _isUnchanged(): boolean {
    // Normalise both sides through the codebase's
    // case- + trailing-dot-insensitive folder so re-typing
    // ``Desktop.local.`` against a stored ``desktop.local``
    // is correctly recognised as unchanged. Backend's
    // ``_endpoints_equal`` does the same fold at compare
    // time, so a Save that slipped past this gate would
    // bounce off ``PRECONDITION_FAILED`` anyway — catching
    // it here keeps the round-trip out of the loop.
    const port = parsePortInput(this._port);
    if (port === null) return false;
    const initialPort = parsePortInput(this._initialPort);
    return (
      normalizeHostnameForCompare(this._hostname) ===
        normalizeHostnameForCompare(this._initialHostname) && port === initialPort
    );
  }

  private _saveDisabled(): boolean {
    return (
      this._submitting ||
      !this._hostnameValid() ||
      parsePortInput(this._port) === null ||
      this._isUnchanged()
    );
  }

  protected render() {
    if (!this._open) return nothing;
    return html`
      <esphome-base-dialog
        ?open=${this._open}
        ?busy=${this._submitting}
        .label=${this._localize("settings.edit_pairing_endpoint_title", {
          label: this._label,
        })}
        @request-close=${this._onRequestClose}
        @after-hide=${this._close}
      >
        <p class="desc">${this._localize("settings.edit_pairing_endpoint_desc")}</p>
        <div class="field">
          <label for="ep-hostname">
            ${this._localize("settings.edit_pairing_endpoint_hostname_label")}
          </label>
          <input
            id="ep-hostname"
            name="hostname"
            type="text"
            autocomplete="off"
            spellcheck="false"
            .value=${this._hostname}
            ?disabled=${this._submitting}
            @input=${this._onHostnameInput}
          />
        </div>
        <div class="field">
          <label for="ep-port">
            ${this._localize("settings.edit_pairing_endpoint_port_label")}
          </label>
          <input
            id="ep-port"
            name="port"
            type="number"
            min="1"
            max="65535"
            .value=${String(this._port)}
            ?disabled=${this._submitting}
            @input=${this._onPortInput}
          />
        </div>
        ${renderErrorBanner(this._errorMessage)}
        <div class="actions">
          <button
            class="btn-secondary"
            type="button"
            ?disabled=${this._submitting}
            @click=${this._close}
          >
            ${this._localize("layout.cancel")}
          </button>
          <button
            class="btn-primary"
            type="button"
            ?disabled=${this._saveDisabled()}
            @click=${this._onSave}
          >
            ${this._localize(
              this._submitting
                ? "settings.edit_pairing_endpoint_saving"
                : "settings.edit_pairing_endpoint_save"
            )}
          </button>
        </div>
      </esphome-base-dialog>
    `;
  }

  static styles = [
    espHomeStyles,
    inputStyles,
    css`
      .desc {
        margin: 0 0 var(--wa-space-m);
        color: var(--wa-color-text-quiet);
        font-size: var(--wa-font-size-s);
      }

      .field {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-2xs);
        margin-bottom: var(--wa-space-m);
      }

      .field-error {
        color: var(--esphome-error);
        font-size: var(--wa-font-size-s);
        margin-top: var(--wa-space-xs);
      }

      .actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--wa-space-s);
        margin-top: var(--wa-space-m);
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-edit-pairing-endpoint-dialog": ESPHomeEditPairingEndpointDialog;
  }
}
