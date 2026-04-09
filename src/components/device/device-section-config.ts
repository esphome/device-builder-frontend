import { consume } from "@lit/context";
import { mdiContentSave, mdiDeleteOutline, mdiHelpCircleOutline, mdiOpenInNew } from "@mdi/js";
import { css, html, LitElement, nothing } from "lit";
import toast from "sonner-js";
import { customElement, property, state } from "lit/decorators.js";
import type { ESPHomeAPI } from "../../api/index.js";
import type { ConfigEntry } from "../../api/types.js";
import { ConfigEntryType } from "../../api/types.js";

// Local type — SectionConfigResponse is not yet available in the WebSocket backend
interface SectionConfigResponse {
  section_key: string;
  section_type: "core" | "component" | "automation";
  title: string;
  description: string;
  docs_url: string;
  icon: string;
  entries: ConfigEntry[];
}
import type { LocalizeFunc } from "../../common/localize.js";
import { apiContext, localizeContext } from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import { registerMdiIcons } from "../../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/divider/divider.js";
import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/input/input.js";
import "@home-assistant/webawesome/dist/components/option/option.js";
import "@home-assistant/webawesome/dist/components/select/select.js";
import "@home-assistant/webawesome/dist/components/spinner/spinner.js";
import "@home-assistant/webawesome/dist/components/switch/switch.js";

registerMdiIcons({
  "content-save": mdiContentSave,
  "delete-outline": mdiDeleteOutline,
  "help-circle-outline": mdiHelpCircleOutline,
  "open-in-new": mdiOpenInNew,
});

@customElement("esphome-device-section-config")
export class ESPHomeDeviceSectionConfig extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: apiContext })
  private _api!: ESPHomeAPI;

  @property()
  configuration = "";

  @property()
  sectionKey = "";

  @property({ type: Number })
  fromLine?: number;

  @state()
  private _config: SectionConfigResponse | null = null;

  @state()
  private _values: Record<string, unknown> = {};

  @state()
  private _loading = false;

  @state()
  private _saving = false;

  @state()
  private _dirty = false;

  @state()
  private _error = "";

  static styles = [
    espHomeStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-m);
        margin-top: var(--wa-space-m);
      }

      .section-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wa-space-s);
      }

      .section-title {
        margin: 0;
        font-size: var(--wa-font-size-m);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-normal);
      }

      .section-desc {
        margin: 0;
        font-size: var(--wa-font-size-xs);
        color: var(--wa-color-text-quiet);
        line-height: 1.5;
      }

      .docs-link {
        display: inline-flex;
        align-items: center;
        gap: var(--wa-space-2xs);
        font-size: var(--wa-font-size-xs);
        color: var(--esphome-primary);
        text-decoration: underline;
      }

      .docs-link:hover {
        text-decoration: none;
      }

      .docs-link wa-icon {
        font-size: 14px;
      }

      .form {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-m);
      }

      .field {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-2xs);
      }

      .field-label {
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-semibold);
        color: var(--wa-color-text-normal);
        display: flex;
        align-items: center;
        gap: var(--wa-space-2xs);
      }

      .field-label .required {
        color: var(--esphome-error);
      }

      .field-description {
        font-size: var(--wa-font-size-2xs);
        color: var(--wa-color-text-quiet);
        margin: 0;
      }

      .alert-entry {
        padding: var(--wa-space-s) var(--wa-space-m);
        background: var(--wa-color-surface-lowered);
        border-radius: var(--wa-border-radius-m);
        font-size: var(--wa-font-size-xs);
        color: var(--wa-color-text-quiet);
        line-height: 1.5;
      }

      .label-entry {
        font-size: var(--wa-font-size-xs);
        color: var(--wa-color-text-subtle);
        font-style: italic;
      }

      .switch-field {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wa-space-m);
      }

      .switch-field .field-info {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--wa-space-s);
        padding-top: var(--wa-space-s);
        border-top: 1px solid var(--wa-color-surface-border);
      }

      .delete-button {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        border: var(--wa-border-width-m) solid var(--wa-color-surface-border);
        background: none;
        color: var(--wa-color-text-quiet);
        padding: var(--wa-space-s) var(--wa-space-l);
        border-radius: var(--wa-border-radius-m);
        cursor: pointer;
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
        font-family: inherit;
        margin-right: auto;
      }

      .delete-button:hover {
        color: var(--esphome-error);
        border-color: var(--esphome-error);
      }

      .delete-button wa-icon {
        font-size: 16px;
      }

      .save-button {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        border: none;
        background: var(--esphome-primary);
        color: var(--esphome-on-primary);
        padding: var(--wa-space-s) var(--wa-space-l);
        border-radius: var(--wa-border-radius-m);
        cursor: pointer;
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
        font-family: inherit;
      }

      .save-button:hover {
        opacity: 0.9;
      }

      .save-button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .save-button wa-icon {
        font-size: 16px;
      }

      .error {
        color: var(--esphome-error);
        font-size: var(--wa-font-size-s);
      }

      .loading {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: var(--wa-space-xl);
      }

      wa-input {
        width: 100%;
      }

      wa-select {
        width: 100%;
      }
    `,
  ];

  updated(changedProperties: Map<string, unknown>) {
    if (
      (changedProperties.has("sectionKey") || changedProperties.has("configuration")) &&
      this.sectionKey &&
      this.configuration
    ) {
      this._loadConfig();
    }
  }

  /** Reload config from backend if the form has no unsaved changes. */
  public reload() {
    if (!this._dirty && this.sectionKey && this.configuration) {
      this._loadConfig();
    }
  }

  private async _loadConfig() {
    this._loading = true;
    this._error = "";
    this._dirty = false;
    try {
      // Fetch the component schema from the catalog
      const component = await this._api.getComponent(this.sectionKey);
      if (!component) {
        this._error = `Unknown section: ${this.sectionKey}`;
        this._config = null;
        this._loading = false;
        return;
      }

      // Parse current values from the device YAML
      const yaml = await this._api.getConfig(this.configuration);
      const currentValues = this._parseYamlSectionValues(yaml);

      this._config = {
        section_key: this.sectionKey,
        section_type: "core",
        title: component.name,
        description: component.description,
        docs_url: component.docs_url,
        icon: "",
        entries: component.config_entries,
      };
      this._values = currentValues;
    } catch (e) {
      this._error = e instanceof Error ? e.message : "Failed to load section config";
      this._config = null;
    } finally {
      this._loading = false;
    }
  }

  /**
   * Parse simple key: value pairs from the YAML section at the current fromLine.
   * Only reads direct children (2-space indent) — skips nested blocks.
   */
  private _parseYamlSectionValues(yaml: string): Record<string, unknown> {
    const lines = yaml.split("\n");
    const values: Record<string, unknown> = {};

    // Find the section start
    let startIdx = -1;
    if (this.fromLine !== undefined) {
      startIdx = this.fromLine - 1; // 1-indexed to 0-indexed
    } else {
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith(`${this.sectionKey}:`)) {
          startIdx = i;
          break;
        }
      }
    }
    if (startIdx < 0) return values;

    // Extract direct children (exactly 2-space indent)
    for (let i = startIdx + 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim() === "") continue;
      // New top-level section — stop
      if (/^[a-zA-Z]/.test(line)) break;

      const match = line.match(/^  ([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)$/);
      if (!match) continue;

      const key = match[1];
      let raw = match[2].trim();
      // Skip if value is empty (nested block)
      if (raw === "") continue;
      // Strip quotes
      if (
        (raw.startsWith('"') && raw.endsWith('"')) ||
        (raw.startsWith("'") && raw.endsWith("'"))
      ) {
        raw = raw.slice(1, -1);
      }
      // Store typed values
      if (raw === "true") values[key] = true;
      else if (raw === "false") values[key] = false;
      else values[key] = raw;
    }

    return values;
  }

  protected render() {
    if (this._loading) {
      return html`<div class="loading"><wa-spinner></wa-spinner></div>`;
    }

    if (this._error && !this._config) {
      return html`<p class="error">${this._error}</p>`;
    }

    if (!this._config) return nothing;

    const visibleEntries = this._config.entries.filter((e) => !e.hidden);

    return html`
      <div class="section-header">
        <h3 class="section-title">${this._config.title}</h3>
        <a
          class="docs-link"
          href=${this._config.docs_url}
          target="_blank"
          rel="noreferrer"
        >
          ${this._localize("device.docs")}
          <wa-icon library="mdi" name="open-in-new"></wa-icon>
        </a>
      </div>
      <p class="section-desc">${this._config.description}</p>
      <div class="form">${visibleEntries.map((entry) => this._renderEntry(entry))}</div>
      ${this._error ? html`<p class="error">${this._error}</p>` : nothing}
      <div class="actions">
        <button
          class="delete-button"
          @click=${this._onDelete}
          title=${this._localize("device.delete_section")}
        >
          <wa-icon library="mdi" name="delete-outline"></wa-icon>
          ${this._localize("device.delete_section")}
        </button>
        <button
          class="save-button"
          ?disabled=${this._saving || !this._dirty}
          @click=${this._onSave}
        >
          <wa-icon library="mdi" name="content-save"></wa-icon>
          ${this._saving ? "Saving…" : this._localize("device.save")}
        </button>
      </div>
    `;
  }

  private _renderEntry(entry: ConfigEntry) {
    switch (entry.type) {
      case ConfigEntryType.DIVIDER:
        return html`<wa-divider></wa-divider>`;

      case ConfigEntryType.LABEL:
        return html`<p class="label-entry">${entry.label}</p>`;

      case ConfigEntryType.ALERT:
        return html`<div class="alert-entry">${entry.label}</div>`;

      case ConfigEntryType.BOOLEAN:
        return this._renderBooleanField(entry);

      case ConfigEntryType.SELECT:
        return this._renderSelectField(entry);

      case ConfigEntryType.SECURE_STRING:
        return this._renderStringField(entry, "password");

      case ConfigEntryType.INTEGER:
        return this._renderNumberField(entry);

      case ConfigEntryType.FLOAT:
        return this._renderNumberField(entry);

      case ConfigEntryType.ICON:
        return this._renderStringField(entry, "text");

      case ConfigEntryType.STRING:
      default:
        return this._renderStringField(entry, "text");
    }
  }

  private _renderStringField(entry: ConfigEntry, inputType: string) {
    const value = String(this._values[entry.key] ?? "");
    return html`
      <div class="field">
        <label class="field-label">
          ${entry.label}
          ${entry.required ? html`<span class="required">*</span>` : nothing}
        </label>
        ${entry.description
          ? html`<p class="field-description">${entry.description}</p>`
          : nothing}
        <wa-input
          type=${inputType}
          .value=${value}
          placeholder=${String(entry.default_value ?? "")}
          @input=${(e: Event) =>
            this._setValue(entry.key, (e.target as HTMLInputElement).value)}
        ></wa-input>
      </div>
    `;
  }

  private _renderNumberField(entry: ConfigEntry) {
    const value = String(this._values[entry.key] ?? "");
    return html`
      <div class="field">
        <label class="field-label">
          ${entry.label}
          ${entry.required ? html`<span class="required">*</span>` : nothing}
        </label>
        ${entry.description
          ? html`<p class="field-description">${entry.description}</p>`
          : nothing}
        <wa-input
          type="number"
          .value=${value}
          placeholder=${String(entry.default_value ?? "")}
          @input=${(e: Event) => {
            const raw = (e.target as HTMLInputElement).value;
            this._setValue(entry.key, raw === "" ? "" : Number(raw));
          }}
        ></wa-input>
      </div>
    `;
  }

  private _renderBooleanField(entry: ConfigEntry) {
    const checked =
      this._values[entry.key] === true || this._values[entry.key] === "true";
    return html`
      <div class="switch-field">
        <div class="field-info">
          <label class="field-label">${entry.label}</label>
          ${entry.description
            ? html`<p class="field-description">${entry.description}</p>`
            : nothing}
        </div>
        <wa-switch
          ?checked=${checked}
          @change=${(e: Event) =>
            this._setValue(
              entry.key,
              (e.target as HTMLInputElement & { checked: boolean }).checked
            )}
        ></wa-switch>
      </div>
    `;
  }

  private _renderSelectField(entry: ConfigEntry) {
    const value = String(this._values[entry.key] ?? "");
    return html`
      <div class="field">
        <label class="field-label">
          ${entry.label}
          ${entry.required ? html`<span class="required">*</span>` : nothing}
        </label>
        ${entry.description
          ? html`<p class="field-description">${entry.description}</p>`
          : nothing}
        <wa-select
          .value=${value}
          @change=${(e: Event) =>
            this._setValue(entry.key, (e.target as HTMLSelectElement).value)}
        >
          ${(entry.options ?? []).map(
            (opt) => html`<wa-option value=${opt.value}>${opt.label}</wa-option>`
          )}
        </wa-select>
      </div>
    `;
  }

  private _setValue(key: string, value: unknown) {
    this._values = { ...this._values, [key]: value };
    this._dirty = true;
  }

  private async _onDelete() {
    if (!this._config) return;
    if (!confirm(this._localize("device.confirm_delete_section", { name: this._config.title }))) {
      return;
    }
    try {
      const yaml = await this._api.getConfig(this.configuration);
      const newYaml = this._removeSectionFromYaml(yaml);
      await this._api.updateConfig(this.configuration, newYaml);
      this.dispatchEvent(
        new CustomEvent("yaml-updated", {
          detail: { yaml: newYaml },
          bubbles: true,
          composed: true,
        })
      );
      // Deselect this section
      this.dispatchEvent(
        new CustomEvent("section-select", {
          detail: { sectionKey: null, fromLine: undefined },
          bubbles: true,
          composed: true,
        })
      );
      toast.success(`"${this._config.title}" removed`, { richColors: true });
    } catch (e) {
      toast.error("Failed to delete section", { richColors: true });
    }
  }

  private async _onSave() {
    if (!this._config) return;
    this._saving = true;
    this._error = "";
    try {
      const yaml = await this._api.getConfig(this.configuration);
      const newYaml = this._updateSectionInYaml(yaml);
      await this._api.updateConfig(this.configuration, newYaml);
      this._dirty = false;
      this.dispatchEvent(
        new CustomEvent("yaml-updated", {
          detail: { yaml: newYaml },
          bubbles: true,
          composed: true,
        })
      );
      toast.success(`"${this._config.title}" saved`, { richColors: true });
    } catch (e) {
      this._error = e instanceof Error ? e.message : "Failed to save";
    } finally {
      this._saving = false;
    }
  }

  /** Remove the entire section (from its top-level key to the next) from the YAML. */
  private _removeSectionFromYaml(yaml: string): string {
    const lines = yaml.split("\n");
    const { start, end } = this._findSectionRange(lines);
    if (start < 0) return yaml;
    lines.splice(start, end - start);
    return lines.join("\n");
  }

  /** Replace the section's direct child values in the YAML with the form values. */
  private _updateSectionInYaml(yaml: string): string {
    const lines = yaml.split("\n");
    const { start, end } = this._findSectionRange(lines);
    if (start < 0) return yaml;

    // Build updated lines for the section
    const sectionHeader = lines[start];
    const newLines = [sectionHeader];

    // Collect existing lines that are nested blocks (not simple key: value)
    const existingNested: string[] = [];
    const existingKeys = new Set<string>();
    for (let i = start + 1; i < end; i++) {
      const line = lines[i];
      const match = line.match(/^  ([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)$/);
      if (match && match[2].trim() !== "") {
        existingKeys.add(match[1]);
      } else if (line.trim() !== "") {
        // Preserve nested blocks and comments as-is
        existingNested.push(line);
      }
    }

    // Write form values
    for (const entry of this._config!.entries) {
      if (entry.hidden) continue;
      const val = this._values[entry.key];
      if (val === undefined || val === "" || val === null) continue;
      const strVal = typeof val === "boolean" ? String(val) : typeof val === "string" && val.includes(" ") ? `"${val}"` : String(val);
      newLines.push(`  ${entry.key}: ${strVal}`);
    }

    // Re-add nested blocks that weren't simple values
    newLines.push(...existingNested);

    lines.splice(start, end - start, ...newLines);
    return lines.join("\n");
  }

  /** Find the 0-indexed line range [start, end) for the current section. */
  private _findSectionRange(lines: string[]): { start: number; end: number } {
    let start = -1;
    if (this.fromLine !== undefined) {
      start = this.fromLine - 1;
    } else {
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith(`${this.sectionKey}:`)) {
          start = i;
          break;
        }
      }
    }
    if (start < 0) return { start: -1, end: -1 };

    // Find the end: next top-level key or EOF
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      if (/^[a-zA-Z]/.test(lines[i])) {
        end = i;
        break;
      }
    }
    return { start, end };
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-device-section-config": ESPHomeDeviceSectionConfig;
  }
}
