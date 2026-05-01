import { consume } from "@lit/context";
import { LitElement, css, html, nothing } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import type { AdoptableDevice } from "../api/types.js";
import type { ESPHomeAPI } from "../api/esphome-api.js";
import type { LocalizeFunc } from "../common/localize.js";
import { apiContext, localizeContext } from "../context/index.js";
import { inputStyles } from "../styles/inputs.js";
import { espHomeStyles } from "../styles/shared.js";
import { validateDeviceName } from "../util/config-validation.js";

import "@home-assistant/webawesome/dist/components/dialog/dialog.js";

/**
 * Strip the optional ``-aabbcc`` / ``-aabbccddeeff`` MAC suffix that
 * factory firmware appends when ``name_add_mac_suffix: True`` is in
 * effect. The resulting YAML the backend writes carries
 * ``name_add_mac_suffix: False`` so the user-chosen name sticks
 * verbatim — pre-filling the field with the stripped form gives users
 * the cleaner default they almost always want, while still letting
 * them keep the suffixed form by editing the input.
 */
const MAC_SUFFIX_RE = /-([0-9a-f]{6}|[0-9a-f]{12})$/i;
function stripMacSuffix(name: string): string {
  return name.replace(MAC_SUFFIX_RE, "");
}

@customElement("esphome-adopt-dialog")
export class ESPHomeAdoptDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: apiContext })
  @state()
  private _api?: ESPHomeAPI;

  @state() private _device: AdoptableDevice | null = null;
  @state() private _name = "";
  @state() private _friendlyName = "";
  // Default off: opting in writes ``api: encryption: key: <psk>`` to
  // the device's YAML, which silently breaks any existing API client
  // (Home Assistant, automations, esphome cli) that doesn't already
  // know the key. Make the user say yes — they should know they're
  // doing it.
  @state() private _encryption = false;
  @state() private _busy = false;
  @state() private _error: string | null = null;

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

      .description {
        font-size: var(--wa-font-size-s);
        color: var(--wa-color-text-normal);
        margin: 0 0 var(--wa-space-m);
        line-height: 1.5;
      }

      .field {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-xs);
        padding-bottom: var(--wa-space-m);
      }

      label {
        font-size: var(--wa-font-size-xs);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-quiet);
      }

      .checkbox-row {
        display: flex;
        align-items: flex-start;
        gap: var(--wa-space-s);
        padding-bottom: var(--wa-space-m);
        cursor: pointer;
        user-select: none;
      }

      .checkbox-row input[type="checkbox"] {
        margin-top: 3px;
      }

      .checkbox-text {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .checkbox-title {
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-normal);
      }

      .checkbox-hint {
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

      .btn--cancel:hover {
        background: var(--wa-color-surface-border);
      }

      .btn--primary {
        background: var(--esphome-success);
        color: var(--esphome-on-primary);
      }

      .btn--primary:hover:not(:disabled) {
        background: color-mix(in srgb, var(--esphome-success), black 10%);
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

      .submit-error {
        color: var(--esphome-error);
        font-size: var(--wa-font-size-xs);
        padding-bottom: var(--wa-space-s);
      }
    `,
  ];

  open(device: AdoptableDevice) {
    this._device = device;
    this._name = stripMacSuffix(device.name);
    this._friendlyName = device.friendly_name || "";
    this._encryption = false;
    this._busy = false;
    this._error = null;
    this._dialog.open = true;
  }

  close() {
    this._dialog.open = false;
  }

  protected render() {
    if (!this._device) {
      return html`<wa-dialog></wa-dialog>`;
    }
    const nameTrimmed = this._name.trim();
    const nameErr = nameTrimmed ? validateDeviceName(nameTrimmed) : null;
    const canSubmit = !!nameTrimmed && !nameErr && !this._busy;
    const displayName = this._device.friendly_name || this._device.name;

    return html`
      <wa-dialog
        label=${this._localize("dashboard.adopt_title")}
        light-dismiss
      >
        <p class="description">
          ${this._localize("dashboard.adopt_description", {
            name: displayName,
          })}
        </p>

        <div class="field">
          <label for="adopt-name">
            ${this._localize("dashboard.adopt_field_name")}
          </label>
          <input
            id="adopt-name"
            type="text"
            class=${nameErr ? "invalid" : ""}
            .value=${this._name}
            ?disabled=${this._busy}
            @input=${(e: Event) => {
              this._name = (e.target as HTMLInputElement).value;
            }}
            @keydown=${(e: KeyboardEvent) => {
              if (e.key === "Enter" && canSubmit) this._submit();
            }}
          />
          ${nameErr
            ? html`<span class="field-error"
                >${this._localize(nameErr.code, nameErr.params)}</span
              >`
            : nothing}
        </div>

        <div class="field">
          <label for="adopt-friendly-name">
            ${this._localize("dashboard.adopt_field_friendly_name")}
          </label>
          <input
            id="adopt-friendly-name"
            type="text"
            .value=${this._friendlyName}
            ?disabled=${this._busy}
            @input=${(e: Event) => {
              this._friendlyName = (e.target as HTMLInputElement).value;
            }}
            @keydown=${(e: KeyboardEvent) => {
              if (e.key === "Enter" && canSubmit) this._submit();
            }}
          />
        </div>

        <label class="checkbox-row">
          <input
            type="checkbox"
            ?checked=${this._encryption}
            ?disabled=${this._busy}
            @change=${(e: Event) => {
              this._encryption = (e.target as HTMLInputElement).checked;
            }}
          />
          <span class="checkbox-text">
            <span class="checkbox-title"
              >${this._localize("dashboard.adopt_encryption_title")}</span
            >
            <span class="checkbox-hint"
              >${this._localize("dashboard.adopt_encryption_hint")}</span
            >
          </span>
        </label>

        ${this._error
          ? html`<div class="submit-error">${this._error}</div>`
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
            @click=${this._submit}
          >
            ${this._busy
              ? this._localize("dashboard.adopt_submit_busy")
              : this._localize("dashboard.adopt_submit")}
          </button>
        </div>
      </wa-dialog>
    `;
  }

  private _submit = async () => {
    if (!this._device || !this._api) return;
    const name = this._name.trim();
    const friendlyName = this._friendlyName.trim();
    if (!name || validateDeviceName(name)) return;

    this._busy = true;
    this._error = null;
    try {
      // ``encryption`` is sent only when the user opted in. Backend
      // signature is ``encryption: str | None = None``; omitting it
      // when False keeps the call site clean and avoids relying on
      // the upstream ``import_config`` branch's ``if encryption:``
      // truthiness check accepting the literal string "false".
      const args: Parameters<ESPHomeAPI["importDevice"]>[0] = {
        name,
        project_name: this._device.project_name,
        package_import_url: this._device.package_import_url,
      };
      if (friendlyName) args.friendly_name = friendlyName;
      if (this._encryption) args.encryption = "true";
      await this._api.importDevice(args);
      this.close();
      this.dispatchEvent(
        new CustomEvent("adopted", {
          detail: { name, friendlyName },
          bubbles: true,
          composed: true,
        }),
      );
    } catch (err) {
      this._busy = false;
      this._error =
        err instanceof Error
          ? err.message
          : this._localize("dashboard.adopt_error_generic");
    }
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-adopt-dialog": ESPHomeAdoptDialog;
  }
}
