import { consume } from "@lit/context";
import { mdiClose } from "@mdi/js";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { ConfigEntry } from "../../api/types.js";

// Types for automation catalog — not yet available in the WebSocket backend
interface AutomationTrigger {
  id: string;
  name: string;
  description: string;
  applicable_to: string[];
  fields: ConfigEntry[];
}

interface AutomationAction {
  id: string;
  name: string;
  description: string;
  fields: ConfigEntry[];
}
import type { ESPHomeAPI } from "../../api/index.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { localizeContext, apiContext } from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import { registerMdiIcons } from "../../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/dialog/dialog.js";
import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({ close: mdiClose });

@customElement("esphome-add-automation-dialog")
export class ESPHomeAddAutomationDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: apiContext })
  private _api!: ESPHomeAPI;

  @property()
  boardName = "";

  @property()
  configuration = "";

  @query("wa-dialog")
  private _dialog!: HTMLElement & { open: boolean };

  @state()
  private _triggers: AutomationTrigger[] = [];

  @state()
  private _actions: AutomationAction[] = [];

  @state()
  private _loading = true;

  @state()
  private _targetName = "";

  @state()
  private _triggerId = "";

  @state()
  private _actionId = "";

  @state()
  private _actionFields: Record<string, string> = {};

  @state()
  private _submitting = false;

  @state()
  private _error = "";

  static styles = [
    espHomeStyles,
    css`
      wa-dialog {
        --width: 540px;
      }

      wa-dialog::part(header) {
        background: var(--esphome-primary);
        padding: 0 var(--wa-space-m);
        height: 40px;
        box-sizing: border-box;
      }

      wa-dialog::part(title) {
        color: var(--esphome-on-primary);
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
      }

      wa-dialog::part(close-button__base) {
        background: transparent;
        border: none;
        box-shadow: none;
        padding: 0;
        min-width: unset;
        min-height: unset;
        color: var(--esphome-on-primary);
        cursor: pointer;
      }

      wa-dialog::part(body) {
        padding: var(--wa-space-l) var(--wa-space-xl);
      }

      wa-dialog::part(footer) {
        display: none;
      }

      .form {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-m);
      }

      .field {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-xs);
      }

      .section-title {
        margin: var(--wa-space-m) 0 0;
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-subtle);
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }

      label {
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-normal);
      }

      label .required { color: var(--esphome-error); margin-left: 2px; }

      input[type="text"],
      input[type="number"],
      select {
        width: 100%;
        padding: var(--wa-space-s) var(--wa-space-m);
        font-size: var(--wa-font-size-m);
        font-family: inherit;
        color: var(--wa-color-text-normal);
        background: var(--wa-color-surface-default);
        border: var(--wa-border-width-m) solid var(--wa-color-surface-border);
        border-radius: var(--wa-border-radius-m);
        box-sizing: border-box;
        outline: none;
      }

      input:focus, select:focus { border-color: var(--esphome-primary); }

      .actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--wa-space-s);
        margin-top: var(--wa-space-m);
      }

      .btn {
        padding: var(--wa-space-s) var(--wa-space-l);
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
        font-family: inherit;
        border-radius: var(--wa-border-radius-m);
        cursor: pointer;
        border: var(--wa-border-width-m) solid transparent;
      }

      .btn-primary {
        background: var(--esphome-primary);
        color: var(--esphome-on-primary);
      }

      .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

      .error { color: var(--esphome-error); font-size: var(--wa-font-size-s); }

      .loading {
        color: var(--wa-color-text-quiet);
        font-size: var(--wa-font-size-s);
        text-align: center;
        padding: var(--wa-space-xl);
      }
    `,
  ];

  public open() {
    this._targetName = "";
    this._triggerId = "";
    this._actionId = "";
    this._actionFields = {};
    this._error = "";
    this._dialog.open = true;
    if (this._triggers.length === 0) this._loadCatalog();
  }

  private async _loadCatalog() {
    this._loading = true;
    try {
      // TODO: Automation catalog is not yet available in the WebSocket backend
      console.warn("Automation catalog not yet supported by backend");
      this._triggers = [];
      this._actions = [];
    } catch (e) {
      console.error("Failed to load automation catalog:", e);
    } finally {
      this._loading = false;
    }
  }

  protected render() {
    return html`
      <wa-dialog
        light-dismiss
        label=${this._localize("device.add_automation_dialog_title", { name: this.boardName })}
      >
        ${this._loading
          ? html`<p class="loading">${this._localize("device.loading_automation_catalog")}</p>`
          : this._renderForm()}
      </wa-dialog>
    `;
  }

  private _renderForm() {
    const selectedAction = this._actions.find((a) => a.id === this._actionId);

    return html`
      <div class="form">
        <p class="section-title">${this._localize("device.automation_target")}</p>
        <div class="field">
          <label>${this._localize("device.automation_target_name")}<span class="required">*</span></label>
          <input
            type="text"
            .value=${this._targetName}
            placeholder=${this._localize("device.automation_target_placeholder")}
            @input=${(e: Event) => {
              this._targetName = (e.target as HTMLInputElement).value;
            }}
          />
        </div>

        <p class="section-title">${this._localize("device.automation_trigger")}</p>
        <div class="field">
          <label>${this._localize("device.automation_trigger_label")}</label>
          <select
            @change=${(e: Event) => {
              this._triggerId = (e.target as HTMLSelectElement).value;
            }}
          >
            ${this._triggers.map(
              (t) => html`<option value=${t.id} ?selected=${t.id === this._triggerId}>${t.name}</option>`
            )}
          </select>
        </div>

        <p class="section-title">${this._localize("device.automation_action")}</p>
        <div class="field">
          <label>${this._localize("device.automation_action_label")}</label>
          <select
            @change=${(e: Event) => {
              this._actionId = (e.target as HTMLSelectElement).value;
              this._actionFields = {};
            }}
          >
            ${this._actions.map(
              (a) => html`<option value=${a.id} ?selected=${a.id === this._actionId}>${a.name}</option>`
            )}
          </select>
        </div>

        ${selectedAction?.fields.map((f) => this._renderActionField(f)) ?? nothing}

        ${this._error ? html`<p class="error">${this._error}</p>` : nothing}

        <div class="actions">
          <button
            class="btn btn-primary"
            ?disabled=${this._submitting || !this._targetName.trim()}
            @click=${this._onSubmit}
          >
            ${this._submitting ? "Adding…" : this._localize("device.add_automation")}
          </button>
        </div>
      </div>
    `;
  }

  private _renderActionField(field: ConfigEntry) {
    const value = this._actionFields[field.key] ?? String(field.default_value ?? "");
    if (field.type === "select" && field.options) {
      return html`
        <div class="field">
          <label>${field.label}${field.required ? html`<span class="required">*</span>` : nothing}</label>
          <select
            @change=${(e: Event) => this._setActionField(field.key, (e.target as HTMLSelectElement).value)}
          >
            ${field.options.map(
              (opt) => html`<option value=${opt.value} ?selected=${opt.value === value}>${opt.label}</option>`
            )}
          </select>
        </div>
      `;
    }
    return html`
      <div class="field">
        <label>${field.label}${field.required ? html`<span class="required">*</span>` : nothing}</label>
        <input
          type=${field.type === "integer" || field.type === "float" ? "number" : "text"}
          .value=${value}
          placeholder=${String(field.default_value ?? "")}
          @input=${(e: Event) => this._setActionField(field.key, (e.target as HTMLInputElement).value)}
        />
      </div>
    `;
  }

  private _setActionField(key: string, value: string) {
    this._actionFields = { ...this._actionFields, [key]: value };
  }

  private async _onSubmit() {
    if (!this.configuration || this._submitting || !this._targetName.trim()) return;
    this._submitting = true;
    this._error = "";
    try {
      // TODO: addAutomation is not yet available in the WebSocket backend
      throw new Error("Automation support is not yet available");
    } catch (err) {
      this._error = err instanceof Error ? err.message : "Failed to add automation";
    } finally {
      this._submitting = false;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-add-automation-dialog": ESPHomeAddAutomationDialog;
  }
}
