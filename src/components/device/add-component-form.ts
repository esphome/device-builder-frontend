import { consume } from "@lit/context";
import { html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { ComponentCatalogEntry, ConfigEntry } from "../../api/types.js";
import { ConfigEntryType } from "../../api/types.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { localizeContext } from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import {
  validateEntries,
  validateEntry,
  type ValidationError,
} from "../../util/config-validation.js";
import { addComponentFormStyles } from "./add-component-form.styles.js";

type FieldValue = string | string[];

@customElement("esphome-add-component-form")
export class ESPHomeAddComponentForm extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @property({ attribute: false })
  component!: ComponentCatalogEntry;

  @property({ type: Boolean })
  submitting = false;

  @property()
  submitError = "";

  @state()
  private _values: Record<string, FieldValue> = {};

  @state()
  private _errors: Map<string, ValidationError> = new Map();

  @state()
  private _touched: Set<string> = new Set();

  @state()
  private _showYaml = false;

  static styles = [espHomeStyles, addComponentFormStyles];

  connectedCallback(): void {
    super.connectedCallback();
    const defaults: Record<string, FieldValue> = {};
    for (const entry of this.component.config_entries) {
      if (entry.default_value != null) {
        defaults[entry.key] = entry.multi_value
          ? [String(entry.default_value)]
          : String(entry.default_value);
      } else if (entry.multi_value) {
        defaults[entry.key] = [];
      }
    }
    this._values = defaults;
  }

  protected render() {
    const editable = this.component.config_entries.filter(
      (e) =>
        !e.hidden &&
        e.type !== ConfigEntryType.LABEL &&
        e.type !== ConfigEntryType.DIVIDER &&
        e.type !== ConfigEntryType.ALERT,
    );
    const disabled = this.submitting;
    const hasErrors = this._errors.size > 0;

    return html`
      <div class="form">
        <p class="form-desc">${this.component.description}</p>
        ${editable.map((e) => this._renderField(e, disabled))}
        <button
          type="button"
          class="toggle-link"
          @click=${() => {
            this._showYaml = !this._showYaml;
          }}
        >
          ${this._showYaml
            ? this._localize("device.yaml_preview_toggle")
            : this._localize("device.yaml_preview")}
        </button>
        ${this._showYaml
          ? html`<pre class="yaml-preview">${this._generateYamlPreview()}</pre>`
          : nothing}
        ${this.submitError
          ? html`<p class="error">${this.submitError}</p>`
          : nothing}
        <div class="actions">
          <button
            class="btn btn-secondary"
            ?disabled=${disabled}
            @click=${this._onCancel}
          >
            ${this._localize("wizard.back")}
          </button>
          <button
            class="btn btn-primary"
            ?disabled=${disabled || hasErrors || !this._isComplete(editable)}
            @click=${this._onSubmit}
          >
            ${this.submitting
              ? this._localize("device.adding")
              : this._localize("device.add_component_action")}
          </button>
        </div>
      </div>
    `;
  }

  private _renderField(entry: ConfigEntry, disabled: boolean) {
    if (entry.multi_value) return this._renderArrayField(entry, disabled);
    if (entry.type === ConfigEntryType.BOOLEAN) {
      return this._renderBooleanField(entry, disabled);
    }
    if (entry.type === ConfigEntryType.SELECT && entry.options) {
      return this._renderSelectField(entry, disabled);
    }
    return this._renderTextField(entry, disabled);
  }

  private _renderTextField(entry: ConfigEntry, disabled: boolean) {
    const value = String(this._values[entry.key] ?? "");
    const err = this._errorFor(entry.key);
    const isNumber =
      entry.type === ConfigEntryType.INTEGER || entry.type === ConfigEntryType.FLOAT;
    const min = entry.range ? String(entry.range[0]) : undefined;
    const max = entry.range ? String(entry.range[1]) : undefined;
    return html`
      <div class="field">
        <label
          >${entry.label}${entry.required
            ? html`<span class="required">*</span>`
            : nothing}</label
        >
        <input
          type=${isNumber ? "number" : "text"}
          class=${err ? "invalid" : ""}
          ?disabled=${disabled}
          min=${min ?? ""}
          max=${max ?? ""}
          step=${entry.type === ConfigEntryType.FLOAT ? "any" : "1"}
          .value=${value}
          placeholder=${String(entry.default_value ?? "")}
          @input=${(e: Event) =>
            this._setField(entry, (e.target as HTMLInputElement).value)}
          @blur=${() => this._touch(entry.key)}
        />
        ${err ? html`<span class="field-error">${this._localize(err.code, err.params)}</span>` : nothing}
      </div>
    `;
  }

  private _renderBooleanField(entry: ConfigEntry, disabled: boolean) {
    const value = this._values[entry.key];
    return html`
      <div class="field">
        <label>
          <input
            type="checkbox"
            ?disabled=${disabled}
            ?checked=${value === "true"}
            @change=${(e: Event) =>
              this._setField(
                entry,
                String((e.target as HTMLInputElement).checked),
              )}
          />
          ${entry.label}
        </label>
      </div>
    `;
  }

  private _renderSelectField(entry: ConfigEntry, disabled: boolean) {
    const value = String(this._values[entry.key] ?? "");
    const err = this._errorFor(entry.key);
    return html`
      <div class="field">
        <label
          >${entry.label}${entry.required
            ? html`<span class="required">*</span>`
            : nothing}</label
        >
        <select
          class=${err ? "invalid" : ""}
          ?disabled=${disabled}
          .value=${value}
          @change=${(e: Event) =>
            this._setField(entry, (e.target as HTMLSelectElement).value)}
        >
          ${entry.options!.map(
            (opt) =>
              html`<option value=${opt.value} ?selected=${opt.value === value}>
                ${opt.label}
              </option>`,
          )}
        </select>
        ${err ? html`<span class="field-error">${this._localize(err.code, err.params)}</span>` : nothing}
      </div>
    `;
  }

  private _renderArrayField(entry: ConfigEntry, disabled: boolean) {
    const items = Array.isArray(this._values[entry.key])
      ? (this._values[entry.key] as string[])
      : [];
    const err = this._errorFor(entry.key);
    return html`
      <div class="field">
        <label
          >${entry.label}${entry.required
            ? html`<span class="required">*</span>`
            : nothing}</label
        >
        ${items.map(
          (item, i) => html`
            <div class="array-row">
              <input
                type="text"
                ?disabled=${disabled}
                .value=${item}
                @input=${(e: Event) =>
                  this._updateArrayItem(
                    entry,
                    i,
                    (e.target as HTMLInputElement).value,
                  )}
              />
              <button
                type="button"
                class="array-btn"
                ?disabled=${disabled}
                @click=${() => this._removeArrayItem(entry, i)}
              >
                ×
              </button>
            </div>
          `,
        )}
        <button
          type="button"
          class="array-btn"
          ?disabled=${disabled}
          @click=${() => this._addArrayItem(entry)}
        >
          +
        </button>
        ${err ? html`<span class="field-error">${this._localize(err.code, err.params)}</span>` : nothing}
      </div>
    `;
  }

  private _setField(entry: ConfigEntry, value: string) {
    this._values = { ...this._values, [entry.key]: value };
    this._errors = new Map(this._errors);
    const err = validateEntry(entry, value);
    if (err) this._errors.set(entry.key, err);
    else this._errors.delete(entry.key);
  }

  private _addArrayItem(entry: ConfigEntry) {
    const current = Array.isArray(this._values[entry.key])
      ? (this._values[entry.key] as string[])
      : [];
    this._values = { ...this._values, [entry.key]: [...current, ""] };
  }

  private _removeArrayItem(entry: ConfigEntry, idx: number) {
    const current = Array.isArray(this._values[entry.key])
      ? (this._values[entry.key] as string[])
      : [];
    this._values = {
      ...this._values,
      [entry.key]: current.filter((_, i) => i !== idx),
    };
    const err = validateEntry(entry, this._values[entry.key]);
    this._errors = new Map(this._errors);
    if (err) this._errors.set(entry.key, err);
    else this._errors.delete(entry.key);
  }

  private _updateArrayItem(entry: ConfigEntry, idx: number, value: string) {
    const current = Array.isArray(this._values[entry.key])
      ? [...(this._values[entry.key] as string[])]
      : [];
    current[idx] = value;
    this._values = { ...this._values, [entry.key]: current };
  }

  private _touch(key: string) {
    this._touched = new Set(this._touched);
    this._touched.add(key);
  }

  private _errorFor(key: string): ValidationError | null {
    return this._errors.get(key) ?? null;
  }

  private _isComplete(entries: ConfigEntry[]): boolean {
    for (const e of entries) {
      if (!e.required) continue;
      const v = this._values[e.key];
      if (v === undefined || (typeof v === "string" && v.trim() === "")) {
        return false;
      }
      if (Array.isArray(v) && v.length === 0) return false;
    }
    return true;
  }

  private _generateYamlPreview(): string {
    const lines: string[] = [`${this.component.id}:`];
    for (const entry of this.component.config_entries) {
      if (entry.hidden) continue;
      const v = this._values[entry.key];
      if (v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) {
        continue;
      }
      if (Array.isArray(v)) {
        lines.push(`  ${entry.key}:`);
        for (const item of v) lines.push(`    - ${item}`);
      } else {
        lines.push(`  ${entry.key}: ${v}`);
      }
    }
    return lines.join("\n");
  }

  private _onCancel() {
    this.dispatchEvent(
      new CustomEvent("form-cancel", { bubbles: true, composed: true }),
    );
  }

  private _onSubmit() {
    const editable = this.component.config_entries.filter((e) => !e.hidden);
    this._errors = validateEntries(editable, this._values);
    this.requestUpdate();
    if (this._errors.size > 0) return;

    const fields: Record<string, unknown> = {};
    for (const entry of this.component.config_entries) {
      if (entry.hidden) continue;
      const v = this._values[entry.key];
      if (v === undefined) continue;
      if (Array.isArray(v)) {
        if (v.length === 0) continue;
        fields[entry.key] = v;
      } else if (v === "") {
        if (entry.required) fields[entry.key] = v;
        continue;
      } else if (entry.type === ConfigEntryType.INTEGER) {
        fields[entry.key] = Number.parseInt(v, 10);
      } else if (entry.type === ConfigEntryType.FLOAT) {
        fields[entry.key] = Number.parseFloat(v);
      } else if (entry.type === ConfigEntryType.BOOLEAN) {
        fields[entry.key] = v === "true";
      } else {
        fields[entry.key] = v;
      }
    }

    this.dispatchEvent(
      new CustomEvent("form-submit", {
        detail: { fields },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-add-component-form": ESPHomeAddComponentForm;
  }
}
