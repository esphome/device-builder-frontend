import { consume } from "@lit/context";
import { mdiClose, mdiLightningBolt, mdiTargetVariant, mdiPlayCircleOutline } from "@mdi/js";
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
import "@home-assistant/webawesome/dist/components/spinner/spinner.js";

registerMdiIcons({
  close: mdiClose,
  "lightning-bolt": mdiLightningBolt,
  "target-variant": mdiTargetVariant,
  "play-circle-outline": mdiPlayCircleOutline,
});

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
        padding: var(--wa-space-l);
      }

      wa-dialog::part(footer) {
        display: none;
      }

      /* ── Form ── */

      .form {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-s);
      }

      /* ── Section blocks ── */

      .section {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: var(--wa-space-m);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        border-radius: var(--wa-border-radius-l);
        background: var(--wa-color-surface-raised);
      }

      .section-header {
        display: flex;
        align-items: center;
        gap: var(--wa-space-s);
        margin-bottom: 2px;
      }

      .section-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        border-radius: var(--wa-border-radius-s);
        flex-shrink: 0;
      }

      .section-icon wa-icon {
        font-size: 16px;
      }

      .section-icon--target {
        background: color-mix(in srgb, var(--esphome-primary), transparent 85%);
        color: var(--esphome-primary);
      }

      .section-icon--trigger {
        background: color-mix(in srgb, var(--esphome-warning), transparent 85%);
        color: var(--esphome-warning);
      }

      .section-icon--action {
        background: color-mix(in srgb, var(--esphome-success), transparent 85%);
        color: var(--esphome-success);
      }

      .section-title {
        margin: 0;
        font-size: var(--wa-font-size-xs);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-normal);
      }

      /* ── Fields ── */

      .field {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      label {
        font-size: var(--wa-font-size-2xs);
        font-weight: var(--wa-font-weight-semibold);
        color: var(--wa-color-text-quiet);
      }

      label .required {
        color: var(--esphome-error);
        margin-left: 2px;
      }

      input[type="text"],
      input[type="number"],
      select {
        width: 100%;
        padding: 9px 12px;
        font-size: var(--wa-font-size-s);
        font-family: inherit;
        color: var(--wa-color-text-normal);
        background: var(--wa-color-surface-default);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        border-radius: var(--wa-border-radius-m);
        box-sizing: border-box;
        outline: none;
        transition:
          border-color 0.15s,
          box-shadow 0.15s;
      }

      input:focus,
      select:focus {
        border-color: var(--esphome-primary);
        box-shadow: 0 0 0 3px
          color-mix(in srgb, var(--esphome-primary), transparent 80%);
      }

      input::placeholder {
        color: var(--wa-color-text-quiet);
      }

      select {
        appearance: auto;
      }

      /* ── Actions ── */

      .actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--wa-space-s);
        padding-top: var(--wa-space-m);
        border-top: 1px solid var(--wa-color-surface-border);
      }

      .dialog-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 8px 18px;
        border-radius: var(--wa-border-radius-m);
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
        font-family: inherit;
        cursor: pointer;
        border: none;
        transition:
          background 0.12s,
          opacity 0.12s;
      }

      .dialog-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .dialog-btn--primary {
        background: var(--esphome-primary);
        color: var(--esphome-on-primary);
      }

      .dialog-btn--primary:hover:not(:disabled) {
        background: color-mix(in srgb, var(--esphome-primary), black 10%);
      }

      /* ── States ── */

      .error {
        color: var(--esphome-error);
        font-size: var(--wa-font-size-xs);
        background: color-mix(in srgb, var(--esphome-error), transparent 92%);
        padding: var(--wa-space-s) var(--wa-space-m);
        border-radius: var(--wa-border-radius-m);
      }

      .loading {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--wa-space-m);
        padding: var(--wa-space-xl);
        color: var(--wa-color-text-quiet);
        font-size: var(--wa-font-size-s);
      }

      .loading wa-spinner {
        font-size: 24px;
        --indicator-color: var(--esphome-primary);
        --track-color: color-mix(
          in srgb,
          var(--esphome-primary),
          transparent 80%
        );
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
      // TODO: Replace with real API call when backend automation catalog is available
      // For now, provide placeholder entries so the UI is functional
      this._triggers = [
        { id: "on_value", name: "On Value", description: "Triggered when the value changes", applicable_to: [], fields: [] },
        { id: "on_press", name: "On Press", description: "Triggered when a button is pressed", applicable_to: [], fields: [] },
        { id: "on_turn_on", name: "On Turn On", description: "Triggered when the component turns on", applicable_to: [], fields: [] },
        { id: "on_turn_off", name: "On Turn Off", description: "Triggered when the component turns off", applicable_to: [], fields: [] },
        { id: "on_boot", name: "On Boot", description: "Triggered when the device boots up", applicable_to: [], fields: [] },
        { id: "on_time", name: "On Time", description: "Triggered at a specific time interval", applicable_to: [], fields: [] },
      ];
      this._actions = [
        { id: "toggle", name: "Toggle", description: "Toggle the component state", fields: [] },
        { id: "turn_on", name: "Turn On", description: "Turn the component on", fields: [] },
        { id: "turn_off", name: "Turn Off", description: "Turn the component off", fields: [] },
        { id: "logger.log", name: "Log Message", description: "Log a message to the console", fields: [
          { key: "message", label: "Message", type: "string" as ConfigEntry["type"], required: true, default_value: "", hidden: false, description: "", options: null, range: null, help_link: null, multi_value: false, advanced: false, translation_key: null, translation_params: null, value: null },
        ] },
        { id: "delay", name: "Delay", description: "Wait for a specified duration", fields: [
          { key: "delay", label: "Duration (ms)", type: "integer" as ConfigEntry["type"], required: true, default_value: "1000", hidden: false, description: "", options: null, range: null, help_link: null, multi_value: false, advanced: false, translation_key: null, translation_params: null, value: null },
        ] },
      ];
      this._triggerId = this._triggers[0].id;
      this._actionId = this._actions[0].id;
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
        label=${this.boardName
          ? this._localize("device.add_automation_dialog_title", { name: this.boardName })
          : this._localize("device.add_automation")}
      >
        ${this._loading
          ? html`
              <div class="loading">
                <wa-spinner></wa-spinner>
                ${this._localize("device.loading_automation_catalog")}
              </div>
            `
          : this._renderForm()}
      </wa-dialog>
    `;
  }

  private _renderForm() {
    const selectedAction = this._actions.find((a) => a.id === this._actionId);

    return html`
      <div class="form">
        <!-- Target section -->
        <div class="section">
          <div class="section-header">
            <div class="section-icon section-icon--target">
              <wa-icon library="mdi" name="target-variant"></wa-icon>
            </div>
            <p class="section-title">${this._localize("device.automation_target")}</p>
          </div>
          <div class="field">
            <label>
              ${this._localize("device.automation_target_name")}<span class="required">*</span>
            </label>
            <input
              type="text"
              .value=${this._targetName}
              placeholder=${this._localize("device.automation_target_placeholder")}
              @input=${(e: Event) => {
                this._targetName = (e.target as HTMLInputElement).value;
              }}
            />
          </div>
        </div>

        <!-- Trigger section -->
        <div class="section">
          <div class="section-header">
            <div class="section-icon section-icon--trigger">
              <wa-icon library="mdi" name="lightning-bolt"></wa-icon>
            </div>
            <p class="section-title">${this._localize("device.automation_trigger")}</p>
          </div>
          <div class="field">
            <label>${this._localize("device.automation_trigger_label")}</label>
            <select
              @change=${(e: Event) => {
                this._triggerId = (e.target as HTMLSelectElement).value;
              }}
            >
              ${this._triggers.length === 0
                ? html`<option disabled selected>No triggers available</option>`
                : this._triggers.map(
                    (t) => html`<option value=${t.id} ?selected=${t.id === this._triggerId}>${t.name}</option>`
                  )}
            </select>
          </div>
        </div>

        <!-- Action section -->
        <div class="section">
          <div class="section-header">
            <div class="section-icon section-icon--action">
              <wa-icon library="mdi" name="play-circle-outline"></wa-icon>
            </div>
            <p class="section-title">${this._localize("device.automation_action")}</p>
          </div>
          <div class="field">
            <label>${this._localize("device.automation_action_label")}</label>
            <select
              @change=${(e: Event) => {
                this._actionId = (e.target as HTMLSelectElement).value;
                this._actionFields = {};
              }}
            >
              ${this._actions.length === 0
                ? html`<option disabled selected>No actions available</option>`
                : this._actions.map(
                    (a) => html`<option value=${a.id} ?selected=${a.id === this._actionId}>${a.name}</option>`
                  )}
            </select>
          </div>
          ${selectedAction?.fields.map((f) => this._renderActionField(f)) ?? nothing}
        </div>

        ${this._error ? html`<p class="error">${this._error}</p>` : nothing}

        <div class="actions">
          <button
            class="dialog-btn dialog-btn--primary"
            ?disabled=${this._submitting || !this._targetName.trim()}
            @click=${this._onSubmit}
          >
            ${this._submitting ? this._localize("device.adding") : this._localize("device.add_automation")}
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
      throw new Error(this._localize("device.add_automation_unavailable"));
    } catch (err) {
      this._error = err instanceof Error ? err.message : this._localize("device.add_automation_error");
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
