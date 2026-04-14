import { consume } from "@lit/context";
import {
  mdiArrowLeft,
  mdiClose,
  mdiCog,
  mdiOpenInNew,
} from "@mdi/js";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { ConfigEntry } from "../../api/types.js";

// Types for config section catalog — not yet available in the WebSocket backend
interface ConfigSection {
  id: string;
  name: string;
  description: string;
  docs_url: string;
  icon: string;
  yaml_template: string;
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
  "arrow-left": mdiArrowLeft,
  cog: mdiCog,
  "open-in-new": mdiOpenInNew,
});

@customElement("esphome-add-config-dialog")
export class ESPHomeAddConfigDialog extends LitElement {
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
  private _sections: ConfigSection[] = [];

  @state()
  private _loading = true;

  @state()
  private _selected: ConfigSection | null = null;

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
        --width: 560px;
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

      /* ── Section grid ── */

      .section-list {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 10px;
      }

      .section-card {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--wa-space-s);
        padding: var(--wa-space-m) var(--wa-space-s);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        border-radius: var(--wa-border-radius-l);
        cursor: pointer;
        background: var(--wa-color-surface-raised);
        text-align: center;
        font-family: inherit;
        transition:
          border-color 0.12s,
          background 0.12s,
          box-shadow 0.12s;
      }

      .section-card:hover {
        border-color: var(--esphome-primary);
        background: color-mix(in srgb, var(--esphome-primary), transparent 95%);
        box-shadow: 0 2px 8px color-mix(in srgb, var(--esphome-primary), transparent 85%);
      }

      .section-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 40px;
        height: 40px;
        border-radius: var(--wa-border-radius-m);
        background: color-mix(in srgb, var(--esphome-primary), transparent 88%);
        color: var(--esphome-primary);
        flex-shrink: 0;
        transition: background 0.12s;
      }

      .section-icon wa-icon {
        font-size: 20px;
      }

      .section-card:hover .section-icon {
        background: color-mix(in srgb, var(--esphome-primary), transparent 75%);
      }

      .section-card-name {
        margin: 0;
        font-size: var(--wa-font-size-xs);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-normal);
        line-height: 1.3;
      }

      /* ── Form view ── */

      .form {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-m);
      }

      .form-header {
        display: flex;
        align-items: flex-start;
        gap: var(--wa-space-m);
        padding-bottom: var(--wa-space-m);
        border-bottom: 1px solid var(--wa-color-surface-border);
      }

      .form-header-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 44px;
        height: 44px;
        border-radius: var(--wa-border-radius-l);
        background: color-mix(in srgb, var(--esphome-primary), transparent 88%);
        color: var(--esphome-primary);
        flex-shrink: 0;
      }

      .form-header-icon wa-icon {
        font-size: 22px;
      }

      .form-header-text {
        flex: 1;
        min-width: 0;
      }

      .form-desc {
        margin: 0;
        font-size: var(--wa-font-size-xs);
        color: var(--wa-color-text-quiet);
        line-height: 1.5;
      }

      .form-docs-link {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        font-size: var(--wa-font-size-2xs);
        color: var(--esphome-primary);
        text-decoration: none;
        margin-top: 4px;
      }

      .form-docs-link:hover {
        text-decoration: underline;
      }

      .form-docs-link wa-icon {
        font-size: 12px;
      }

      .field {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      label {
        font-size: var(--wa-font-size-xs);
        font-weight: var(--wa-font-weight-semibold);
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
        padding: 9px 12px;
        font-size: var(--wa-font-size-s);
        font-family: inherit;
        color: var(--wa-color-text-normal);
        background: var(--wa-color-surface-raised);
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

      .dialog-btn--cancel {
        background: var(--wa-color-surface-lowered);
        color: var(--wa-color-text-normal);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
      }

      .dialog-btn--cancel:hover:not(:disabled) {
        background: var(--wa-color-surface-border);
      }

      .dialog-btn--primary {
        background: var(--esphome-primary);
        color: var(--esphome-on-primary);
      }

      .dialog-btn--primary:hover:not(:disabled) {
        background: color-mix(in srgb, var(--esphome-primary), black 10%);
      }

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
    this._selected = null;
    this._fieldValues = {};
    this._error = "";
    this._dialog.open = true;
    if (this._sections.length === 0) this._loadCatalog();
  }

  private async _loadCatalog() {
    this._loading = true;
    try {
      // Fetch core infrastructure components from the component catalog
      const response = await this._api.getComponents({
        category: "core",
        limit: 100,
      });
      this._sections = response.components.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        docs_url: c.docs_url,
        icon: "",
        yaml_template: `${c.id}:\n`,
        fields: c.config_entries,
      }));
    } catch (e) {
      console.error("Failed to load config catalog:", e);
    } finally {
      this._loading = false;
    }
  }

  protected render() {
    const isForm = this._selected !== null;
    return html`
      <wa-dialog light-dismiss>
        <span slot="label" class="dialog-label">
          ${isForm
            ? html`<button class="back-button" @click=${this._onBack}>
                <wa-icon library="mdi" name="arrow-left"></wa-icon>
              </button>`
            : nothing}
          ${isForm
            ? this._selected!.name
            : this.boardName
              ? this._localize("device.add_config_dialog_title", { name: this.boardName })
              : this._localize("device.add_config")}
        </span>
        ${isForm ? this._renderForm() : this._renderSectionList()}
      </wa-dialog>
    `;
  }

  private _renderSectionList() {
    if (this._loading) {
      return html`
        <div class="loading">
          <wa-spinner></wa-spinner>
          ${this._localize("device.loading_config_catalog")}
        </div>
      `;
    }
    return html`
      <div class="section-list">
        ${this._sections.map(
          (s) => html`
            <button class="section-card" @click=${() => this._selectSection(s)}>
              <div class="section-icon">
                <wa-icon library="mdi" name="cog"></wa-icon>
              </div>
              <p class="section-card-name">${s.name}</p>
            </button>
          `
        )}
      </div>
    `;
  }

  private _renderForm() {
    const section = this._selected!;
    return html`
      <div class="form">
        <div class="form-header">
          <div class="form-header-icon">
            <wa-icon library="mdi" name="cog"></wa-icon>
          </div>
          <div class="form-header-text">
            <p class="form-desc">${section.description}</p>
            ${section.docs_url
              ? html`<a
                  class="form-docs-link"
                  href=${section.docs_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  ${this._localize("device.docs")}
                  <wa-icon library="mdi" name="open-in-new"></wa-icon>
                </a>`
              : nothing}
          </div>
        </div>
        ${section.fields.map((f) => this._renderField(f))}
        ${this._error ? html`<p class="error">${this._error}</p>` : nothing}
        <div class="actions">
          <button class="dialog-btn dialog-btn--cancel" @click=${this._onBack}>
            ${this._localize("wizard.back")}
          </button>
          <button
            class="dialog-btn dialog-btn--primary"
            ?disabled=${this._submitting || !this._isFormValid()}
            @click=${this._onSubmit}
          >
            ${this._submitting ? this._localize("device.adding") : this._localize("device.add_config")}
          </button>
        </div>
      </div>
    `;
  }

  private _renderField(field: ConfigEntry) {
    const value = this._fieldValues[field.key] ?? String(field.default_value ?? "");
    if (field.type === "select" && field.options) {
      return html`
        <div class="field">
          <label>${field.label}${field.required ? html`<span class="required">*</span>` : nothing}</label>
          <select
            @change=${(e: Event) => this._setField(field.key, (e.target as HTMLSelectElement).value)}
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
          @input=${(e: Event) => this._setField(field.key, (e.target as HTMLInputElement).value)}
        />
      </div>
    `;
  }

  private _setField(key: string, value: string) {
    this._fieldValues = { ...this._fieldValues, [key]: value };
  }

  private _isFormValid(): boolean {
    if (!this._selected) return false;
    return this._selected.fields
      .filter((f) => f.required)
      .every((f) => {
        const v = this._fieldValues[f.key] ?? String(f.default_value ?? "");
        return v.trim() !== "";
      });
  }

  private _selectSection(section: ConfigSection) {
    const defaults: Record<string, string> = {};
    for (const f of section.fields) {
      if (f.default_value != null) defaults[f.key] = String(f.default_value);
    }
    this._fieldValues = defaults;
    this._selected = section;
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
      for (const field of this._selected.fields) {
        if (field.hidden) continue;
        const v = this._fieldValues[field.key] ?? String(field.default_value ?? "");
        if (!v && !field.required) continue;
        if (field.type === "integer" || field.type === "float") {
          fields[field.key] = Number(v);
        } else if (field.type === "boolean") {
          fields[field.key] = v === "true";
        } else {
          fields[field.key] = v;
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
      this._error = err instanceof Error ? err.message : this._localize("device.add_config_error");
    } finally {
      this._submitting = false;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-add-config-dialog": ESPHomeAddConfigDialog;
  }
}
