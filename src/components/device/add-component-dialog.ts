import { consume } from "@lit/context";
import { mdiArrowLeft, mdiClose } from "@mdi/js";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { ComponentCatalogEntry, ConfigEntry } from "../../api/types.js";
import { ConfigEntryType } from "../../api/types.js";
import type { ESPHomeAPI } from "../../api/index.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { localizeContext, apiContext } from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import { registerMdiIcons } from "../../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/dialog/dialog.js";
import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "./component-catalog.js";
import type { ESPHomeComponentCatalog } from "./component-catalog.js";

registerMdiIcons({ close: mdiClose, "arrow-left": mdiArrowLeft });

@customElement("esphome-add-component-dialog")
export class ESPHomeAddComponentDialog extends LitElement {
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

  @query("esphome-component-catalog")
  private _catalog!: ESPHomeComponentCatalog;

  @state()
  private _selected: ComponentCatalogEntry | null = null;

  @state()
  private _fieldValues: Record<string, string> = {};

  @state()
  private _submitting = false;

  @state()
  private _error = "";

  static styles = [
    espHomeStyles,
    css`
      wa-dialog {
        --width: 900px;
      }

      wa-dialog.form-view {
        --width: 480px;
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

      .dialog-label {
        display: flex;
        align-items: center;
        gap: var(--wa-space-xs);
        color: var(--esphome-on-primary);
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
      }

      .back-button {
        display: inline-flex;
        align-items: center;
        border: none;
        background: none;
        padding: 2px;
        margin-right: var(--wa-space-2xs);
        color: var(--esphome-on-primary);
        cursor: pointer;
        border-radius: 4px;
        opacity: 0.85;
      }

      .back-button:hover {
        opacity: 1;
      }

      /* ── Field form ── */

      .form {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-m);
      }

      .form-title {
        margin: 0 0 var(--wa-space-s);
        font-size: var(--wa-font-size-m);
        font-weight: var(--wa-font-weight-bold);
      }

      .form-desc {
        margin: 0 0 var(--wa-space-m);
        font-size: var(--wa-font-size-s);
        color: var(--wa-color-text-quiet);
      }

      .field {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-xs);
      }

      label {
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-normal);
      }

      label .required {
        color: var(--esphome-error);
        margin-left: 2px;
      }

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

      input:focus,
      select:focus {
        border-color: var(--esphome-primary);
      }

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

      .btn-secondary {
        background: none;
        border-color: var(--wa-color-surface-border);
        color: var(--wa-color-text-normal);
      }

      .btn-primary {
        background: var(--esphome-primary);
        color: var(--esphome-on-primary);
      }

      .btn-primary:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .error {
        color: var(--esphome-error);
        font-size: var(--wa-font-size-s);
      }
    `,
  ];

  public open() {
    this._selected = null;
    this._fieldValues = {};
    this._error = "";
    this._dialog.open = true;
    // Trigger catalog load when dialog opens (ensures WS is connected)
    this.updateComplete.then(() => this._catalog?.load());
  }

  protected render() {
    const isForm = this._selected !== null;
    return html`
      <wa-dialog
        class=${isForm ? "form-view" : ""}
        light-dismiss
        @add-component=${this._onComponentSelected}
      >
        <span slot="label" class="dialog-label">
          ${isForm
            ? html`<button class="back-button" @click=${this._onBack}>
                <wa-icon library="mdi" name="arrow-left"></wa-icon>
              </button>`
            : nothing}
          ${isForm
            ? this._selected!.name
            : this.boardName
              ? this._localize("device.add_component_dialog_title", { name: this.boardName })
              : this._localize("device.add_component")}
        </span>
        ${isForm ? this._renderForm() : html`<esphome-component-catalog></esphome-component-catalog>`}
      </wa-dialog>
    `;
  }

  private _renderForm() {
    const comp = this._selected!;
    // Only show editable config entries (not labels, dividers, alerts, hidden)
    const editableEntries = comp.config_entries.filter(
      (e) =>
        !e.hidden &&
        e.type !== ConfigEntryType.LABEL &&
        e.type !== ConfigEntryType.DIVIDER &&
        e.type !== ConfigEntryType.ALERT
    );

    return html`
      <div class="form">
        <p class="form-desc">${comp.description}</p>
        ${editableEntries.map((e) => this._renderField(e))}
        ${this._error ? html`<p class="error">${this._error}</p>` : nothing}
        <div class="actions">
          <button class="btn btn-secondary" @click=${this._onBack}>
            ${this._localize("wizard.back")}
          </button>
          <button
            class="btn btn-primary"
            ?disabled=${this._submitting || !this._isFormValid()}
            @click=${this._onSubmit}
          >
            ${this._submitting ? this._localize("device.adding") : this._localize("device.add_component_action")}
          </button>
        </div>
      </div>
    `;
  }

  private _renderField(entry: ConfigEntry) {
    const value = this._fieldValues[entry.key] ?? String(entry.default_value ?? "");

    if (entry.type === ConfigEntryType.SELECT && entry.options) {
      return html`
        <div class="field">
          <label>${entry.label}${entry.required ? html`<span class="required">*</span>` : nothing}</label>
          <select
            .value=${value}
            @change=${(e: Event) => this._setField(entry.key, (e.target as HTMLSelectElement).value)}
          >
            ${entry.options.map(
              (opt) => html`<option value=${opt.value} ?selected=${opt.value === value}>${opt.label}</option>`
            )}
          </select>
        </div>
      `;
    }
    if (entry.type === ConfigEntryType.BOOLEAN) {
      return html`
        <div class="field">
          <label>
            <input
              type="checkbox"
              ?checked=${value === "true"}
              @change=${(e: Event) =>
                this._setField(entry.key, String((e.target as HTMLInputElement).checked))}
            />
            ${entry.label}
          </label>
        </div>
      `;
    }
    const inputType = entry.type === ConfigEntryType.INTEGER || entry.type === ConfigEntryType.FLOAT
      ? "number"
      : "text";
    return html`
      <div class="field">
        <label>${entry.label}${entry.required ? html`<span class="required">*</span>` : nothing}</label>
        <input
          type=${inputType}
          .value=${value}
          placeholder=${String(entry.default_value ?? "")}
          @input=${(e: Event) => this._setField(entry.key, (e.target as HTMLInputElement).value)}
        />
      </div>
    `;
  }

  private _setField(key: string, value: string) {
    this._fieldValues = { ...this._fieldValues, [key]: value };
  }

  private _isFormValid(): boolean {
    if (!this._selected) return false;
    return this._selected.config_entries
      .filter((e) => e.required && !e.hidden)
      .every((e) => {
        const v = this._fieldValues[e.key] ?? String(e.default_value ?? "");
        return v.trim() !== "";
      });
  }

  private _onComponentSelected(e: CustomEvent<{ component: ComponentCatalogEntry }>) {
    e.stopPropagation();
    const { component } = e.detail;
    // Pre-fill defaults from config entries
    const defaults: Record<string, string> = {};
    for (const entry of component.config_entries) {
      if (entry.default_value != null) defaults[entry.key] = String(entry.default_value);
    }
    this._fieldValues = defaults;
    this._selected = component;
    this._error = "";
  }

  private _onBack() {
    this._selected = null;
    this._error = "";
  }

  private async _onSubmit() {
    if (!this._selected || !this.configuration || this._submitting) return;
    this._submitting = true;
    this._error = "";
    try {
      const fields: Record<string, unknown> = {};
      for (const entry of this._selected.config_entries) {
        if (entry.hidden) continue;
        const v = this._fieldValues[entry.key] ?? String(entry.default_value ?? "");
        if (!v && !entry.required) continue;
        if (entry.type === ConfigEntryType.INTEGER) {
          fields[entry.key] = Number(v);
        } else if (entry.type === ConfigEntryType.FLOAT) {
          fields[entry.key] = Number(v);
        } else if (entry.type === ConfigEntryType.BOOLEAN) {
          fields[entry.key] = v === "true";
        } else {
          fields[entry.key] = v;
        }
      }
      const { yaml } = await this._api.addComponent(this.configuration, {
        component_id: this._selected.id,
        fields,
      });
      this._dialog.open = false;
      this._selected = null;
      this.dispatchEvent(
        new CustomEvent("yaml-updated", {
          detail: { yaml },
          bubbles: true,
          composed: true,
        })
      );
    } catch (err) {
      this._error = err instanceof Error ? err.message : this._localize("device.add_component_error");
    } finally {
      this._submitting = false;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-add-component-dialog": ESPHomeAddComponentDialog;
  }
}
