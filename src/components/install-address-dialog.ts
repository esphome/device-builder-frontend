import { consume } from "@lit/context";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { LocalizeFunc } from "../common/localize.js";
import { localizeContext } from "../context/index.js";
import { inputStyles } from "../styles/inputs.js";
import { espHomeStyles } from "../styles/shared.js";

import "@home-assistant/webawesome/dist/components/dialog/dialog.js";

/**
 * Advanced "Install to Specific Address" dialog.
 *
 * Surfaces from the per-device kebab menu and (optionally) from
 * a chevron on the OTA option of the install-method dialog.
 * Lets the user override the address the CLI flashes against —
 * needed when the dashboard's auto-resolved address is stale
 * (mDNS TTL hasn't expired yet but the device has moved to a new
 * IP, DHCP lease change, network reconfiguration, …) and the
 * standard one-click OTA path would target the *wrong* device.
 *
 * The single-click install path is intentionally untouched —
 * "just OTA" stays one click. This dialog is the explicit advanced
 * escape hatch.
 *
 * Submits an ``install-to-address`` event with the typed value.
 * Validation is light (non-empty, no whitespace); the backend's
 * ``_validate_port`` does the strict IP / hostname check and
 * returns a ``CommandError(INVALID_ARGS)`` on typos which the
 * caller's flow surfaces.
 */
@customElement("esphome-install-address-dialog")
export class ESPHomeInstallAddressDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @property() deviceName = "";
  @property() configuration = "";
  /** The address the dashboard currently resolves the device to.
   *  Pre-filled into the input so the user can edit a single
   *  octet rather than retype the whole IP. */
  @property() currentAddress = "";

  @state() private _value = "";

  @query("wa-dialog")
  private _dialog!: HTMLElement & { open: boolean };

  static styles = [
    espHomeStyles,
    inputStyles,
    css`
      wa-dialog {
        --width: 460px;
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

      .body {
        padding-bottom: var(--wa-space-m);
      }

      .desc {
        font-size: var(--wa-font-size-s);
        color: var(--wa-color-text-quiet);
        line-height: 1.5;
        margin-bottom: var(--wa-space-m);
      }

      .field {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-xs);
      }

      label {
        font-size: var(--wa-font-size-xs);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-quiet);
      }

      .hint {
        font-size: var(--wa-font-size-2xs);
        color: var(--wa-color-text-quiet);
        margin-top: var(--wa-space-2xs);
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

      .btn--cancel:hover {
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
    `,
  ];

  /** Open the dialog seeded with a device's metadata. */
  open(opts: {
    deviceName: string;
    configuration: string;
    currentAddress: string;
  }) {
    this.deviceName = opts.deviceName;
    this.configuration = opts.configuration;
    this.currentAddress = opts.currentAddress;
    // Pre-fill with the current address so the user only has to
    // edit (typically a single octet) instead of retyping it all.
    this._value = opts.currentAddress;
    this._dialog.open = true;
  }

  close() {
    this._dialog.open = false;
  }

  protected render() {
    const trimmed = this._value.trim();
    const canSubmit = trimmed.length > 0 && trimmed !== "OTA";
    const showCurrent =
      this.currentAddress && trimmed !== this.currentAddress;

    return html`
      <wa-dialog
        label=${this._localize("dashboard.action_install_address_title")}
        light-dismiss
      >
        <div class="body">
          <p class="desc">
            ${this._localize("dashboard.action_install_address_desc", {
              name: this.deviceName,
            })}
          </p>
          <div class="field">
            <label>${this._localize("dashboard.action_install_address_label")}</label>
            <input
              type="text"
              autocomplete="off"
              spellcheck="false"
              placeholder="192.168.1.42"
              .value=${this._value}
              @input=${(e: Event) => {
                this._value = (e.target as HTMLInputElement).value;
              }}
              @keydown=${(e: KeyboardEvent) => {
                if (e.key === "Enter" && canSubmit) this._confirm();
              }}
            />
            ${showCurrent
              ? html`<span class="hint">${this._localize(
                  "dashboard.action_install_address_current",
                  { address: this.currentAddress },
                )}</span>`
              : nothing}
          </div>
        </div>
        <div class="actions">
          <button class="btn btn--cancel" @click=${this.close}>
            ${this._localize("layout.cancel")}
          </button>
          <button
            class="btn btn--primary"
            ?disabled=${!canSubmit}
            @click=${this._confirm}
          >
            ${this._localize("dashboard.action_install_address_confirm")}
          </button>
        </div>
      </wa-dialog>
    `;
  }

  private _confirm() {
    const port = this._value.trim();
    if (!port) return;
    this.close();
    this.dispatchEvent(
      new CustomEvent("install-to-address", {
        detail: { configuration: this.configuration, port },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-install-address-dialog": ESPHomeInstallAddressDialog;
  }
}
