import { consume } from "@lit/context";
import { mdiAlertCircleOutline } from "@mdi/js";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { ESPHomeAPI } from "../../api/index.js";
import type {
  BoardCatalogEntry,
  ComponentCatalogEntry,
  ConfigEntry,
} from "../../api/types.js";
import { ConfigEntryType } from "../../api/types.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { apiContext, localizeContext } from "../../context/index.js";
import { inputStyles } from "../../styles/inputs.js";
import { espHomeStyles } from "../../styles/shared.js";
import { ComponentNameResolverController } from "../../util/component-name-resolver-controller.js";
import {
  validateEntries,
  type ValidationError,
} from "../../util/config-validation.js";
import { seedBoardPinDefaults } from "../../util/board-pin-defaults.js";
import {
  collectExistingIds,
  generateDefaultComponentId,
} from "../../util/default-component-id.js";
import { renderMarkdown } from "../../util/markdown.js";
import { setIn } from "../../util/nested-values.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import {
  parseTopLevelComponents,
  parseYamlBoolean,
  serializeYamlValues,
} from "../../util/yaml-serialize.js";
import { addComponentFormStyles } from "./add-component-form.styles.js";
import "./config-entry-form.js";
import type { ConfigEntryValueChange } from "./config-entry-form.js";
import { collectRenderablePaths } from "./config-entry-render-filter.js";
import { resolveEntryLabel } from "./config-entry-renderers-shared.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({ "alert-circle-outline": mdiAlertCircleOutline });

@customElement("esphome-add-component-form")
export class ESPHomeAddComponentForm extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: apiContext })
  private _api?: ESPHomeAPI;

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

  /** Surface text for the rare path where ``_onSubmit`` would return
   * silently (validation errors on entries hidden from the rendered
   * form, or a defensive missing-deps fallback). The dialog's
   * ``submitError`` is reserved for API failures — this is the
   * pre-API "the form refused to submit and here's why" lane. */
  @state()
  private _localBlockMessage = "";

  @state()
  private _showYaml = false;

  /** Resolves dep ids (``i2c``) to their catalog name (``I²C Bus``)
   * for the missing-deps banner. Owns the cache subscription so a
   * fresh entry triggers a re-render without bookkeeping here. */
  private readonly _depResolver = new ComponentNameResolverController(
    this,
    () => this._api,
    () => this.board?.esphome.platform || undefined,
  );

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
        // Reset block message on retarget — without this, a "submit
        // bailed" notice from the previous component (in the dep-flow
        // detour the form gets reused for) would leak into the next
        // component's form.
        this._localBlockMessage = "";
        this._depResolver.kickoff(this.component.dependencies ?? []);
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
      const seeded = this._generateDefaultId();
      if (seeded !== null) next = { ...next, id: seeded };
    }

    // Seed pin entries from the board's manifest when the board has
    // a pin tagged with the matching peripheral feature. Without this,
    // ESPHome falls back to its compile-time defaults — which on the
    // ESP32-C3 (and other variants without an SCL/SDA alias) are
    // either invalid or wrong-numbered: i2c on C3 emits an
    // "Invalid pin number: 22" squiggle because the bus block
    // falls back to ESP32 GPIO22/21.
    next = seedBoardPinDefaults(
      this.component.id,
      this.component.config_entries,
      this.board,
      next,
    );

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

  private _generateDefaultId(): string | null {
    return generateDefaultComponentId(
      this.component.id,
      this.component.multi_conf,
      collectExistingIds(this.yaml),
    );
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
      this.board?.esphome.platform ?? null,
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
        ${this._localBlockMessage
          ? html`<p class="error">${this._localBlockMessage}</p>`
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
   *
   * The dep id is resolved to the catalog entry's friendly ``name`` so
   * the button reads ``Add I²C Bus`` instead of ``Add i2c``. Falls
   * back to the raw id until the cache lookup lands (kicked off in
   * ``willUpdate``).
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
                  domain: this._depResolver.resolve(d),
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

  /**
   * User-facing label for an error key. Walks the schema following
   * each dotted segment of the key (``auth.password`` → walk into
   * the ``auth`` NESTED group, then find ``password``) and returns
   * the leaf entry's ``label``. Falls back to the raw key when the
   * schema lookup misses (defensive against MAP entries or future
   * structural shapes the walker doesn't model).
   *
   * The hidden-validation message lane is the bug-report flow, so
   * a precise leaf label speeds triage — ``Password: This field is
   * required`` is more useful than ``Auth: This field is required``.
   */
  private _labelForErrorKey(errKey: string): string {
    const segments = errKey.split(".");
    let entries: ConfigEntry[] | null = this.component.config_entries;
    let entry: ConfigEntry | undefined;
    for (const seg of segments) {
      if (!entries) break;
      entry = entries.find((e) => e.key === seg);
      if (!entry) break;
      entries =
        entry.type === ConfigEntryType.NESTED
          ? entry.config_entries ?? []
          : null;
    }
    return entry ? resolveEntryLabel(entry, this._localize) : errKey;
  }

  /**
   * True when at least one error in the map lands on an entry the
   * shared ``esphome-config-entry-form`` actually renders. Built on
   * ``collectRenderablePaths`` so the visibility check stays in
   * lockstep with the form's render filter — without that lockstep
   * an error on a hidden field would bail the submit silently.
   *
   * The add-component form passes ``required-only`` and never
   * exposes a show-advanced toggle, so we always pass
   * ``showAdvanced: false`` here.
   */
  private _anyErrorIsVisible(
    errors: Map<string, ValidationError>,
    presentComponents: Set<string>,
  ): boolean {
    // The caller (``_onSubmit``) only enters this branch when
    // ``errors.size > 0``, but we keep the guard so the helper is
    // safe to call from anywhere.
    if (errors.size === 0) return false;
    const renderedPaths = collectRenderablePaths(
      this.component.config_entries,
      this._values,
      {
        requiredOnly: true,
        showAdvanced: false,
        presentComponents,
        targetPlatform: this.board?.esphome.platform ?? null,
      },
    );
    for (const key of errors.keys()) {
      if (renderedPaths.has(key)) return true;
    }
    return false;
  }

  private _onValueChange(e: CustomEvent<ConfigEntryValueChange>) {
    const { path, value } = e.detail;
    this._values = setIn(this._values, path, value);
    // Clear any error on the path the user just edited so the
    // red ring disappears as they type. Same for the
    // hidden-validation block message: any user input is a fresh
    // signal that supersedes the previous bail; the next submit
    // attempt re-evaluates from scratch.
    const errKey = path.join(".");
    if (this._errors.has(errKey)) {
      const next = new Map(this._errors);
      next.delete(errKey);
      this._errors = next;
    }
    if (this._localBlockMessage) this._localBlockMessage = "";
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
    // Reset the local block message at the top of every submit
    // attempt so a stale notice from a previous click can't render
    // alongside a fresh result. Both bail paths below set their
    // own message; the success path leaves it cleared.
    this._localBlockMessage = "";
    const presentComponents = parseTopLevelComponents(this.yaml);
    // Block submit when there are missing top-level dependencies.
    // The button should already be disabled in that case, but defend
    // here too in case the YAML changed under us between renders.
    const missingDeps = (this.component.dependencies ?? []).filter(
      (d) => !presentComponents.has(d),
    );
    if (missingDeps.length > 0) {
      // Should be unreachable — the button-disabled predicate uses the
      // same check. If we get here, the YAML changed under us between
      // renders. Surface a visible message that names the missing
      // domain(s) so the user can act, instead of returning silently.
      this._localBlockMessage = `${this._localize(
        "device.missing_dependencies_title",
        { name: this.component.name },
      )} (${missingDeps.join(", ")})`;
      return;
    }

    // Validate the entire schema. If anything fails, surface the
    // errors inline (the shared form will pick them up by path).
    const errors = validateEntries(
      this.component.config_entries,
      this._values,
      presentComponents,
      this.board?.esphome.platform ?? null,
    );
    if (errors.size > 0) {
      this._errors = errors;
      const visible = this._anyErrorIsVisible(errors, presentComponents);
      if (!visible) {
        // Hidden-validation case: every error key lands on an entry
        // the user can't see in required-only mode (advanced or
        // optional leaf). Use a dedicated locale key — distinct from
        // the API-failure ``add_component_error`` so #issues triage
        // can tell client-side validation blocks from server-side
        // failures — and append a per-error breakdown using each
        // entry's user-facing label and the localized code reason
        // (e.g. ``Frequency: Must be a number``). Falls back to
        // ``key: code`` when the schema lookup misses (defensive
        // against nested paths the heuristic can't follow).
        const summary = [...errors.entries()]
          .map(([key, err]) =>
            `${this._labelForErrorKey(key)}: ${this._localize(err.code, err.params)}`,
          )
          .join("; ");
        this._localBlockMessage = `${this._localize(
          "device.add_component_hidden_validation_error",
        )} (${summary})`;
      }
      return;
    }
    this._errors = new Map();
    this._localBlockMessage = "";

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
        out[entry.key] = parseYamlBoolean(raw) === true;
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
