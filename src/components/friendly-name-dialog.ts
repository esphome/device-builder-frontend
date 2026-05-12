import { consume } from "@lit/context";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { LocalizeFunc } from "../common/localize.js";
import { localizeContext } from "../context/index.js";
import { inputStyles } from "../styles/inputs.js";
import { espHomeStyles } from "../styles/shared.js";
import { renderInlineError } from "../util/render-error.js";

import "@home-assistant/webawesome/dist/components/checkbox/checkbox.js";
import "./base-dialog.js";

/**
 * Edit-friendly-name dialog. Single input + an "Install
 * immediately" toggle.
 *
 * The friendly name lives in the device's YAML
 * (``esphome.friendly_name``); editing it through this dialog
 * rewrites the YAML directly and (when the toggle is on) follows
 * up with an OTA install so the running device announces the new
 * name on the wire.
 *
 * Use case: user adopts a Made-For-ESPHome device through the
 * dashboard, then wants to rename it. They don't know YAML yet —
 * this dialog is the click-through for "I want to call my bulb
 * 'Reading Lamp'".
 *
 * Emits ``friendly-name-confirm`` with
 * ``{newFriendlyName, install}``. The page handler calls the
 * backend, then optionally queues the firmware install + opens
 * the streaming command-dialog.
 */
@customElement("esphome-friendly-name-dialog")
export class ESPHomeFriendlyNameDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @property()
  deviceName = "";

  @property()
  currentFriendlyName = "";

  @state()
  private _value = "";

  @state()
  private _install = true;

  @state()
  private _open = false;

  static styles = [
    espHomeStyles,
    inputStyles,
    css`
      esphome-base-dialog {
        --width: 460px;
      }

      esphome-base-dialog::part(header) {
        padding: var(--wa-space-l) var(--wa-space-l) var(--wa-space-s);
      }

      esphome-base-dialog::part(title) {
        font-size: var(--wa-font-size-m);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-normal);
      }

      esphome-base-dialog::part(body) {
        padding: 0 var(--wa-space-l);
      }

      esphome-base-dialog::part(footer) {
        display: none;
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

      .helper {
        font-size: var(--wa-font-size-xs);
        color: var(--wa-color-text-quiet);
        margin-top: var(--wa-space-2xs);
      }

      .install-row {
        display: flex;
        align-items: center;
        gap: var(--wa-space-s);
        padding-bottom: var(--wa-space-m);
      }

      .install-row .helper {
        margin-top: 0;
        flex: 1;
      }

      .actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--wa-space-s);
        padding: var(--wa-space-m) 0 var(--wa-space-l);
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

      .field-error {
        color: var(--esphome-error);
        font-size: var(--wa-font-size-xs);
        margin-top: var(--wa-space-2xs);
      }
    `,
  ];

  open(deviceName: string, currentFriendlyName: string) {
    this.deviceName = deviceName;
    this.currentFriendlyName = currentFriendlyName;
    this._value = currentFriendlyName;
    // Default to install-after-edit: this dialog's whole point is
    // to land the new name on the device. Users who deliberately
    // want a YAML-only edit (offline device, batch later) can
    // toggle off — but the common case is "rename and apply."
    this._install = true;
    this._open = true;
  }

  close() {
    this._open = false;
  }

  private _onAfterHide = (): void => {
    // <esphome-base-dialog> re-emits after-hide for every
    // dismissal path (Esc / outside-click / X / reactive
    // ?open flip). Flip our local open flag so the next
    // render's ?open binding matches.
    this._open = false;
  };

  protected render() {
    const trimmed = this._value.trim();
    const unchanged = trimmed === this.currentFriendlyName;
    const empty = !trimmed;
    const err = empty ? { code: "dashboard.action_friendly_name_required" } : null;
    const canSubmit = !empty && !unchanged && !err;

    return html`
      <esphome-base-dialog
        ?open=${this._open}
        .label=${this._localize("dashboard.action_friendly_name_title", {
          name: this.deviceName,
        })}
        @after-hide=${this._onAfterHide}
      >
        <div class="field">
          <label for="friendly-name-input"
            >${this._localize("dashboard.action_friendly_name_label")}</label
          >
          <input
            id="friendly-name-input"
            type="text"
            class=${err ? "invalid" : ""}
            .value=${this._value}
            placeholder=${this.currentFriendlyName || this.deviceName}
            @input=${(e: Event) => {
              this._value = (e.target as HTMLInputElement).value;
            }}
            @keydown=${(e: KeyboardEvent) => {
              if (e.key === "Enter" && canSubmit) this._confirm();
            }}
          />
          ${err
            ? renderInlineError(this._localize(err.code))
            : html`<span class="helper"
                >${this._localize("dashboard.action_friendly_name_helper")}</span
              >`}
        </div>
        <div class="install-row">
          <wa-checkbox
            ?checked=${this._install}
            @change=${(e: Event) => {
              this._install = (e.target as HTMLInputElement).checked;
            }}
            >${this._localize(
              "dashboard.action_friendly_name_install_after"
            )}</wa-checkbox
          >
        </div>
        ${!this._install
          ? html`<div class="field">
              <span class="helper"
                >${this._localize("dashboard.action_friendly_name_install_skipped")}</span
              >
            </div>`
          : nothing}
        <div class="actions">
          <button class="btn btn--cancel" @click=${this.close}>
            ${this._localize("layout.cancel")}
          </button>
          <button
            class="btn btn--primary"
            ?disabled=${!canSubmit}
            @click=${this._confirm}
          >
            ${this._localize("dashboard.action_friendly_name_confirm")}
          </button>
        </div>
      </esphome-base-dialog>
    `;
  }

  private _confirm = () => {
    const newFriendlyName = this._value.trim();
    if (!newFriendlyName || newFriendlyName === this.currentFriendlyName) {
      return;
    }
    this.close();
    this.dispatchEvent(
      new CustomEvent<{ newFriendlyName: string; install: boolean }>(
        "friendly-name-confirm",
        {
          detail: { newFriendlyName, install: this._install },
          bubbles: true,
          composed: true,
        }
      )
    );
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-friendly-name-dialog": ESPHomeFriendlyNameDialog;
  }
}
