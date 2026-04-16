import { consume } from "@lit/context";
import { mdiContentSave, mdiHelpCircleOutline, mdiOpenInNew } from "@mdi/js";
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

  private _loadId = 0;

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

      .save-button:hover:not(:disabled) {
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
      (changedProperties.has("sectionKey") || changedProperties.has("configuration") || changedProperties.has("fromLine")) &&
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
    const id = ++this._loadId;
    this._loading = true;
    this._error = "";
    this._config = null;
    this._dirty = false;

    try {
      const component = await this._api.getComponent(this.sectionKey);

      // Stale — user clicked another component while this was loading
      if (id !== this._loadId) return;

      if (!component) {
        this._error = this._localize("device.unknown_section", { key: this.sectionKey });
        this._loading = false;
        return;
      }

      const yaml = await this._api.getConfig(this.configuration);

      if (id !== this._loadId) return;

      this._config = {
        section_key: this.sectionKey,
        section_type: "core",
        title: component.name,
        description: component.description,
        docs_url: component.docs_url,
        icon: "",
        entries: component.config_entries,
      };
      this._values = this._parseYamlSectionValues(yaml);
    } catch (e) {
      if (id !== this._loadId) return;
      const msg = e instanceof Error ? e.message : "";
      // Show a friendly message for timeouts instead of the raw error
      this._error = msg.includes("timed out")
        ? this._localize("device.load_config_error")
        : msg || this._localize("device.load_config_error");
    } finally {
      if (id === this._loadId) {
        this._loading = false;
      }
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

    // Detect if this is a list item (  - key: val) vs a top-level section (key:)
    const isListItem = /^\s+-\s/.test(lines[startIdx]);
    // For list items, the first line may have `  - platform: binary`
    // and children are at 4-space indent. For top-level, children are at 2-space.
    const childIndent = isListItem ? "    " : "  ";
    const childRegex = new RegExp(
      `^${childIndent}([a-zA-Z_][a-zA-Z0-9_]*):\\s*(.*)$`,
    );

    // Also parse the first line of a list item (  - key: value)
    if (isListItem) {
      const firstMatch = lines[startIdx].match(
        /^\s+-\s+([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)$/,
      );
      if (firstMatch) {
        const key = firstMatch[1];
        let raw = firstMatch[2].trim();
        if (raw !== "") {
          if (
            (raw.startsWith('"') && raw.endsWith('"')) ||
            (raw.startsWith("'") && raw.endsWith("'"))
          )
            raw = raw.slice(1, -1);
          if (raw === "true") values[key] = true;
          else if (raw === "false") values[key] = false;
          else values[key] = raw;
        }
      }
    }

    for (let i = startIdx + 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim() === "") continue;
      // Stop at a line with equal or less indentation (next item or top-level key)
      if (isListItem) {
        if (/^\s+-\s/.test(line) || /^[a-zA-Z]/.test(line)) break;
      } else {
        if (/^[a-zA-Z]/.test(line)) break;
      }

      const match = line.match(childRegex);
      if (!match) continue;

      const key = match[1];
      let raw = match[2].trim();
      if (raw === "") continue;
      if (
        (raw.startsWith('"') && raw.endsWith('"')) ||
        (raw.startsWith("'") && raw.endsWith("'"))
      ) {
        raw = raw.slice(1, -1);
      }
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
          class="save-button"
          ?disabled=${this._saving || !this._dirty}
          @click=${this._onSave}
        >
          <wa-icon library="mdi" name="content-save"></wa-icon>
          ${this._saving ? this._localize("device.saving") : this._localize("device.save")}
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
          value=${value}
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

  private async _onSave() {
    if (!this._config) return;
    this._saving = true;
    this._error = "";
    try {
      const yaml = await this._api.getConfig(this.configuration);
      const newYaml = this._updateSectionInYaml(yaml);
      const title = this._config.title;
      this._api.updateConfig(this.configuration, newYaml).catch((e) => {
        this._error = e instanceof Error ? e.message : this._localize("device.save_error");
      });
      this._dirty = false;
      this.dispatchEvent(
        new CustomEvent("yaml-updated", {
          detail: { yaml: newYaml },
          bubbles: true,
          composed: true,
        })
      );
      toast.success(this._localize("device.section_saved_toast", { title }), { richColors: true });
    } catch (e) {
      this._error = e instanceof Error ? e.message : this._localize("device.save_error");
    } finally {
      this._saving = false;
    }
  }

  /** Remove the entire section (from its top-level key to the next) from the YAML. */
  /** Replace the section's direct child values in the YAML with the form values. */
  private _updateSectionInYaml(yaml: string): string {
    const lines = yaml.split("\n");
    const { start, end } = this._findSectionRange(lines);
    if (start < 0) return yaml;

    const isListItem = /^\s+-\s/.test(lines[start]);
    const childIndent = isListItem ? "    " : "  ";
    const childRegex = new RegExp(
      `^${childIndent}([a-zA-Z_][a-zA-Z0-9_]*):\\s*(.*)$`,
    );

    // Build updated lines for the section
    const sectionHeader = lines[start];
    const newLines = [sectionHeader];

    // Collect existing lines that are nested blocks (not simple key: value)
    const existingNested: string[] = [];
    for (let i = start + 1; i < end; i++) {
      const line = lines[i];
      const match = line.match(childRegex);
      if (match && match[2].trim() !== "") {
        // Simple key: value — will be replaced by form values
      } else if (line.trim() !== "") {
        existingNested.push(line);
      }
    }

    // Write form values at the correct indent
    for (const entry of this._config!.entries) {
      if (entry.hidden) continue;
      const val = this._values[entry.key];
      if (val === undefined || val === "" || val === null) continue;
      const strVal = typeof val === "boolean" ? String(val) : typeof val === "string" && val.includes(" ") ? `"${val}"` : String(val);
      newLines.push(`${childIndent}${entry.key}: ${strVal}`);
    }

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

    const isListItem = /^\s+-\s/.test(lines[start]);

    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      // For list items, stop at the next list item or top-level key
      if (isListItem) {
        if (/^\s+-\s/.test(lines[i]) || /^[a-zA-Z]/.test(lines[i])) {
          end = i;
          break;
        }
      } else {
        if (/^[a-zA-Z]/.test(lines[i])) {
          end = i;
          break;
        }
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
