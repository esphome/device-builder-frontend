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
  // Default on — the legacy dashboard added an encryption key to
  // every adopted device unconditionally and the lack of a way to
  // opt out was the actual annoyance. Keep the secure-by-default
  // behaviour, just expose a checkbox so users who don't want it
  // (e.g. they're staying with plain MQTT) can untick it.
  @state() private _encryption = true;
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
    /* Default to the discovered hostname verbatim — including the
       MAC-suffix factory firmware appends. The backend writes the
       new YAML with ``name_add_mac_suffix: False`` so whatever the
       user picks sticks; users who want a cleaner name can edit the
       suffix off, but defaulting to a stripped form silently dropped
       the disambiguator on devices like ``apollo-plt-1-983300``. */
    this._name = device.name;
    this._friendlyName = device.friendly_name || "";
    this._encryption = true;
    this._busy = false;
    this._error = null;
    this._dialog.open = true;
  }

  close = () => {
    /* Arrow function so ``@click=${this.close}`` from the cancel
       button keeps ``this`` bound to the dialog. With a plain method,
       Lit hands the listener to ``addEventListener`` which calls it
       with ``this === undefined`` (strict mode) and the
       ``this._dialog`` access blows up. */
    this._dialog.open = false;
  };

  /** Block dialog dismissal while the import request is in flight,
   *  so a stray click outside / Esc keypress can't hide an error
   *  that's about to surface. ``light-dismiss`` is also gated on
   *  ``!_busy`` for belt-and-suspenders, but the close-request hook
   *  catches Esc and the close-button-base too. */
  private _onRequestClose = (e: Event) => {
    if (this._busy) {
      e.preventDefault();
    }
  };

  protected render() {
    /* Always render the wa-dialog with the same template shape, even
       before a device is set. Returning a different template
       (``<wa-dialog></wa-dialog>``) on the first render and then a
       fully-populated one on the second made Lit swap the wa-dialog
       instance — so the ``_dialog.open = true`` we set in ``open()``
       was applied to a wa-dialog that was about to be thrown away,
       and the user had to click Take Control twice for the dialog to
       actually appear. */
    const device = this._device;
    const nameTrimmed = this._name.trim();
    const nameErr = nameTrimmed ? validateDeviceName(nameTrimmed) : null;
    const canSubmit = !!device && !!nameTrimmed && !nameErr && !this._busy;
    const displayName = device ? device.friendly_name || device.name : "";

    return html`
      <wa-dialog
        label=${this._localize("dashboard.adopt_title")}
        ?light-dismiss=${!this._busy}
        @wa-request-close=${this._onRequestClose}
      >
        ${device
          ? html`
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
                    >${this._localize(
                      "dashboard.adopt_encryption_title",
                    )}</span
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
            `
          : nothing}
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
      this._error =
        err instanceof Error
          ? err.message
          : this._localize("dashboard.adopt_error_generic");
    } finally {
      /* Always clear the busy state. On success the dialog closes
         and the user never sees this — but if anything downstream
         of the await throws, the dialog stays open and the Submit
         button has to be live again so the user can retry or edit
         the inputs. Resetting only in the catch branch would leave
         the button stuck on "Taking control…" in that edge case. */
      this._busy = false;
    }
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-adopt-dialog": ESPHomeAdoptDialog;
  }
}
