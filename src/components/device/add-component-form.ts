import { consume } from "@lit/context";
import { mdiAlertCircleOutline } from "@mdi/js";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type {
  BoardCatalogEntry,
  ComponentCatalogEntry,
  ConfigEntry,
} from "../../api/types.js";
import { ConfigEntryType } from "../../api/types.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { localizeContext } from "../../context/index.js";
import { inputStyles } from "../../styles/inputs.js";
import { espHomeStyles } from "../../styles/shared.js";
import {
  validateEntries,
  type ValidationError,
} from "../../util/config-validation.js";
import { renderMarkdown } from "../../util/markdown.js";
import { setIn } from "../../util/nested-values.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import {
  parseTopLevelComponents,
  serializeYamlValues,
} from "../../util/yaml-serialize.js";
import { addComponentFormStyles } from "./add-component-form.styles.js";
import "./config-entry-form.js";
import type { ConfigEntryValueChange } from "./config-entry-form.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({ "alert-circle-outline": mdiAlertCircleOutline });

@customElement("esphome-add-component-form")
export class ESPHomeAddComponentForm extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @property({ attribute: false })
  component!: ComponentCatalogEntry;

  /** Board metadata; forwarded to the shared form for pin pickers. */
  @property({ attribute: false })
  board: BoardCatalogEntry | null = null;

  /** Current device YAML; forwarded to the shared form for ID
   * reference dropdowns and used here for the dependency check. */
  @property()
  yaml = "";

  /**
   * Optional initial value for an ID-reference field. Used by the
   * dialog after a "+ Add <domain>" detour finishes — we pre-fill the
   * just-created component's id into the original form's matching
   * `references_component: <domain>` field, so the user doesn't have
   * to pick from the dropdown again.
   */
  @property({ attribute: false })
  prefillReference: { domain: string; id: string } | null = null;

  @property({ type: Boolean })
  submitting = false;

  @property()
  submitError = "";

  @state()
  private _values: Record<string, unknown> = {};

  @state()
  private _errors: Map<string, ValidationError> = new Map();

  @state()
  private _showYaml = false;

  static styles = [
    espHomeStyles,
    inputStyles,
    addComponentFormStyles,
    css`
      /* Banner shown when the component has unmet dependencies
         (e.g. a gpio light needs a configured output: first). */
      .deps-warning {
        display: flex;
        gap: var(--wa-space-s);
        padding: var(--wa-space-s) var(--wa-space-m);
        background: color-mix(
          in srgb,
          var(--esphome-warning, #d97706),
          transparent 88%
        );
        border: var(--wa-border-width-s) solid
          var(--esphome-warning, #d97706);
        border-radius: var(--wa-border-radius-m);
        color: var(--wa-color-text-normal);
        font-size: var(--wa-font-size-s);
        line-height: 1.45;
      }

      .deps-warning wa-icon {
        flex-shrink: 0;
        font-size: 20px;
        color: var(--esphome-warning, #d97706);
      }

      .deps-warning-body {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-2xs);
        flex: 1;
        min-width: 0;
      }

      .deps-warning-title {
        font-weight: var(--wa-font-weight-bold);
      }

      .deps-warning-actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wa-space-2xs);
        margin-top: var(--wa-space-2xs);
      }

      .dep-button {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 4px 10px;
        background: var(--esphome-warning, #d97706);
        color: var(--esphome-on-primary, white);
        border: none;
        border-radius: var(--wa-border-radius-m);
        font-family: inherit;
        font-size: var(--wa-font-size-xs);
        font-weight: var(--wa-font-weight-bold);
        cursor: pointer;
        transition: opacity 0.12s;
      }

      .dep-button:hover {
        opacity: 0.9;
      }
    `,
  ];

  /** True once we've seeded `_values` for the current component. */
  private _initialized = false;

  willUpdate(changedProperties: Map<string, unknown>) {
    super.willUpdate(changedProperties);
    // Initialize the form values once we have both `component` and
    // (if applicable) `prefillReference` set. We can't do this in
    // `connectedCallback` because Lit applies property bindings as
    // part of the update lifecycle, so on first paint they're not
    // guaranteed to be set yet. Re-run when the component changes
    // (the same form instance can be retargeted to a different
    // component in the dep-flow detour).
    if (changedProperties.has("component") || !this._initialized) {
      if (this.component) {
        this._initialized = true;
        this._initValues();
      }
    }
  }

  /**
   * Build the initial `_values` for the current component:
   *  1. Seed required entries' default values (recursively).
   *  2. Auto-generate a unique `id` for the top-level id field.
   *  3. If we were just brought back from a "+ Add <domain>" detour,
   *     prefill the field that points at that domain with the new id.
   */
  private _initValues() {
    // Featured-component entries (ids prefixed with `featured.`) carry
    // backend-baked presets in `default_value` for arbitrary fields,
    // not just required ones. Seed every entry with a non-null default
    // when filling a featured entry so a board-pinned (locked) optional
    // field actually emits its preset on submit — otherwise the
    // backend's locked-validation would reject the empty payload.
    const seedAll = this.component.id.startsWith("featured.");
    let next = this._seedDefaults(this.component.config_entries, seedAll);

    const idEntry = this.component.config_entries.find(
      (e) => e.key === "id" && e.type === ConfigEntryType.ID,
    );
    if (idEntry && next["id"] === undefined) {
      next = { ...next, id: this._generateDefaultId() };
    }

    if (this.prefillReference) {
      const targetPath = this._findReferencePath(
        this.component.config_entries,
        this.prefillReference.domain,
        [],
      );
      if (targetPath) {
        next = setIn(next, targetPath, this.prefillReference.id);
      }
    }

    this._values = next;
  }

  /**
   * Walk the schema recursively to find the path of the first entry
   * with `references_component === domain`. Returns null if the
   * schema doesn't reference the domain — defensive against the
   * dialog passing a prefill that doesn't apply to this form.
   */
  private _findReferencePath(
    entries: ConfigEntry[],
    domain: string,
    prefix: string[],
  ): string[] | null {
    for (const entry of entries) {
      if (entry.type === ConfigEntryType.NESTED) {
        const found = this._findReferencePath(
          entry.config_entries ?? [],
          domain,
          [...prefix, entry.key],
        );
        if (found) return found;
        continue;
      }
      if (entry.references_component === domain) {
        return [...prefix, entry.key];
      }
    }
    return null;
  }

  /**
   * Seed initial form values. By default only required fields' defaults
   * are pre-filled — pre-filling optional fields the user can't see
   * would just bloat the payload with values they never explicitly
   * chose. NESTED entries recurse regardless of whether the parent is
   * required, since a non-required group can still contain required
   * descendants we want to seed.
   *
   * When `seedAll` is true, every entry with a non-null `default_value`
   * is seeded — used for featured components so backend-baked presets
   * land in the payload even on optional fields.
   */
  private _seedDefaults(
    entries: ConfigEntry[],
    seedAll: boolean = false,
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const entry of entries) {
      if (entry.type === ConfigEntryType.NESTED) {
        const sub = this._seedDefaults(entry.config_entries ?? [], seedAll);
        if (Object.keys(sub).length > 0) out[entry.key] = sub;
        continue;
      }
      if (!seedAll && !entry.required) continue;
      if (entry.default_value != null) {
        out[entry.key] = entry.multi_value
          ? [String(entry.default_value)]
          : entry.default_value;
      } else if (entry.multi_value && entry.required) {
        out[entry.key] = [];
      }
    }
    return out;
  }

  private _generateDefaultId(): string {
    // "switch.gpio" -> "switch_gpio"; "wifi" -> "wifi"
    const slug = this.component.id.replace(/\./g, "_").toLowerCase();
    const existing = this._collectExistingIds(this.yaml);

    // Always start from `_1`. Even single-instance components get a
    // numeric suffix because the bare slug clashes with the
    // top-level YAML key — `web_server:` block with `id: web_server`
    // means `id(web_server)` references are ambiguous and can also
    // collide with ESPHome's auto-generated component-typed
    // identifiers. The suffix is cheap insurance.
    let n = 1;
    let candidate = `${slug}_${n}`;
    while (existing.has(candidate)) {
      n++;
      candidate = `${slug}_${n}`;
    }
    return candidate;
  }

  /**
   * Scan the YAML for every `id:` line and return the set of values.
   * Best-effort regex match — same approach the ID-reference picker
   * uses, deliberately simple (we only need a uniqueness check, not
   * a full parse).
   */
  private _collectExistingIds(yaml: string): Set<string> {
    const ids = new Set<string>();
    if (!yaml) return ids;
    for (const line of yaml.split("\n")) {
      const m = line.match(/^\s+(?:-\s+)?id:\s*["']?(\S+?)["']?\s*$/);
      if (m) ids.add(m[1]);
    }
    return ids;
  }

  protected render() {
    const disabled = this.submitting;
    const presentComponents = parseTopLevelComponents(this.yaml);
    // Top-level dependencies the catalog entry declares as required.
    // For example a `light.binary` light needs an `output:` block
    // configured first. Surface these to the user instead of letting
    // them submit a config that won't validate.
    const missingDeps = (this.component.dependencies ?? []).filter(
      (d) => !presentComponents.has(d),
    );

    // The shared form filters its own visibility — but we still need
    // to know whether everything required is filled in to enable the
    // submit button. Run validation against the current values; if
    // any required errors come back, the form is incomplete.
    const validation = validateEntries(
      this.component.config_entries,
      this._values,
      presentComponents,
    );
    const isComplete = !this._hasRequiredErrors(validation);

    return html`
      <div class="form">
        <p class="form-desc">${renderMarkdown(this.component.description)}</p>
        ${missingDeps.length > 0
          ? this._renderMissingDeps(missingDeps)
          : nothing}
        <esphome-config-entry-form
          .entries=${this.component.config_entries}
          .values=${this._values}
          .errors=${this._errors}
          .board=${this.board}
          .yaml=${this.yaml}
          .presentComponents=${presentComponents}
          ?disabled=${disabled}
          ?required-only=${true}
          @value-change=${this._onValueChange}
        ></esphome-config-entry-form>
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
            ?disabled=${disabled || !isComplete || missingDeps.length > 0}
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

  /**
   * Banner shown when one or more entries from `component.dependencies`
   * aren't yet configured at the top level. The submit button is
   * disabled while this is showing. Each missing dep is rendered as a
   * button that takes the user back to the catalog filtered to that
   * domain — they pick one, add it, then come back to this component.
   */
  private _renderMissingDeps(missing: string[]) {
    return html`
      <div class="deps-warning" role="alert">
        <wa-icon library="mdi" name="alert-circle-outline"></wa-icon>
        <div class="deps-warning-body">
          <div class="deps-warning-title">
            ${this._localize("device.missing_dependencies_title", {
              name: this.component.name,
            })}
          </div>
          <div>${this._localize("device.missing_dependencies_body")}</div>
          <div class="deps-warning-actions">
            ${missing.map(
              (d) => html`<button
                type="button"
                class="dep-button"
                @click=${() => this._onAddDep(d)}
              >
                ${this._localize("device.missing_dependencies_add", {
                  domain: d,
                })}
              </button>`,
            )}
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Emit an event the parent dialog uses to switch back to the
   * catalog view, filtered to the requested dependency domain.
   */
  private _onAddDep(domain: string) {
    this.dispatchEvent(
      new CustomEvent("navigate-to-dep", {
        detail: { domain },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /** True if any error in the map has the `validation.required` code. */
  private _hasRequiredErrors(errors: Map<string, ValidationError>): boolean {
    for (const e of errors.values()) {
      if (e.code === "validation.required") return true;
    }
    return false;
  }

  private _onValueChange(e: CustomEvent<ConfigEntryValueChange>) {
    const { path, value } = e.detail;
    this._values = setIn(this._values, path, value);
    // Clear any error on the path the user just edited so the
    // red ring disappears as they type.
    const errKey = path.join(".");
    if (this._errors.has(errKey)) {
      const next = new Map(this._errors);
      next.delete(errKey);
      this._errors = next;
    }
  }

  private _generateYamlPreview(): string {
    const lines: string[] = [`${this.component.id}:`];
    lines.push(...serializeYamlValues(this._values, "  "));
    return lines.join("\n");
  }

  private _onCancel() {
    this.dispatchEvent(
      new CustomEvent("form-cancel", { bubbles: true, composed: true }),
    );
  }

  private _onSubmit() {
    const presentComponents = parseTopLevelComponents(this.yaml);
    // Block submit when there are missing top-level dependencies.
    // The button should already be disabled in that case, but defend
    // here too in case the YAML changed under us between renders.
    const missingDeps = (this.component.dependencies ?? []).filter(
      (d) => !presentComponents.has(d),
    );
    if (missingDeps.length > 0) return;

    // Validate the entire schema. If anything fails, surface the
    // errors inline (the shared form will pick them up by path).
    const errors = validateEntries(
      this.component.config_entries,
      this._values,
      presentComponents,
    );
    if (errors.size > 0) {
      this._errors = errors;
      return;
    }
    this._errors = new Map();

    // Coerce the values dict for the API: strip empties so we don't
    // send blank optional fields, and recurse through nested objects
    // and arrays unchanged (the backend handles structured payloads).
    const fields = this._coerceFields(
      this.component.config_entries,
      this._values,
    );

    this.dispatchEvent(
      new CustomEvent("form-submit", {
        detail: { fields },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /**
   * Convert raw form values into the API payload. Drops empty strings
   * (unless the entry is required), keeps arrays as-is, and recurses
   * through NESTED groups. Numeric / boolean entries are coerced to
   * their proper types so the backend sees `5` not `"5"`.
   */
  private _coerceFields(
    entries: ConfigEntry[],
    values: Record<string, unknown>,
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const entry of entries) {
      if (entry.hidden) continue;
      const raw = values[entry.key];

      if (entry.type === ConfigEntryType.NESTED) {
        const childValues =
          raw !== null && typeof raw === "object" && !Array.isArray(raw)
            ? (raw as Record<string, unknown>)
            : {};
        const sub = this._coerceFields(
          entry.config_entries ?? [],
          childValues,
        );
        if (Object.keys(sub).length > 0) out[entry.key] = sub;
        continue;
      }

      if (raw === undefined) continue;
      if (Array.isArray(raw)) {
        if (raw.length === 0) continue;
        out[entry.key] = raw;
        continue;
      }
      if (raw === "") {
        if (entry.required) out[entry.key] = raw;
        continue;
      }

      if (entry.type === ConfigEntryType.INTEGER) {
        const n = typeof raw === "number" ? raw : Number.parseInt(String(raw), 10);
        if (!Number.isNaN(n)) out[entry.key] = n;
      } else if (entry.type === ConfigEntryType.FLOAT) {
        const n =
          typeof raw === "number" ? raw : Number.parseFloat(String(raw));
        if (!Number.isNaN(n)) out[entry.key] = n;
      } else if (entry.type === ConfigEntryType.BOOLEAN) {
        out[entry.key] = raw === true || raw === "true";
      } else {
        out[entry.key] = raw;
      }
    }
    return out;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-add-component-form": ESPHomeAddComponentForm;
  }
}
