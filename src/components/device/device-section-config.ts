import { consume } from "@lit/context";
import {
  mdiContentSave,
  mdiDelete,
  mdiInformationOutline,
  mdiOpenInNew,
} from "@mdi/js";
import { html, LitElement, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import toast from "sonner-js";
import type { ESPHomeAPI } from "../../api/index.js";
import type { BoardCatalogEntry, ConfigEntry } from "../../api/types.js";
import {
  MAP_SECTIONS,
  resolveSectionEntries,
} from "../../util/section-entry-overrides.js";
import { fetchComponent } from "../../util/component-name-cache.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { apiContext, localizeContext } from "../../context/index.js";
import { inputStyles } from "../../styles/inputs.js";
import { espHomeStyles } from "../../styles/shared.js";
import {
  anyAdvancedEntry,
  findFirstErrorTarget,
} from "../../util/config-entry-tree.js";
import {
  validateEntries,
  type ValidationError,
} from "../../util/config-validation.js";
import { renderMarkdown } from "../../util/markdown.js";
import { setIn } from "../../util/nested-values.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import {
  parseYamlSectionValues,
  removeSectionFromYaml,
  updateSectionInYaml,
} from "../../util/yaml-section-values.js";
import { resolveCurrentFromLine } from "../../util/yaml-sections.js";
import { parseTopLevelComponents } from "../../util/yaml-serialize.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/spinner/spinner.js";
import "@home-assistant/webawesome/dist/components/switch/switch.js";
import "../confirm-dialog.js";
import type { ESPHomeConfirmDialog } from "../confirm-dialog.js";
import "./config-entry-form.js";
import type {
  ConfigEntryValueChange,
  ESPHomeConfigEntryForm,
} from "./config-entry-form.js";
import { deviceSectionConfigStyles } from "./device-section-config.styles.js";

registerMdiIcons({
  "content-save": mdiContentSave,
  delete: mdiDelete,
  "information-outline": mdiInformationOutline,
  "open-in-new": mdiOpenInNew,
});

// `esphome:` is the device's identity block — required for the
// configuration to compile. Hide the delete button there to prevent
// the user accidentally bricking the file in one click.
const UNDELETABLE_SECTIONS = new Set(["esphome"]);

// Local type — SectionConfigResponse is not yet available in the WebSocket backend
interface SectionConfigResponse {
  section_key: string;
  section_type: "core" | "component" | "automation";
  title: string;
  description: string;
  docs_url: string;
  icon: string;
  image_url: string;
  entries: ConfigEntry[];
}

/**
 * Top-level keys we always treat as YAML-only regardless of what the
 * backend returns. `packages` is the remaining holdout — its YAML
 * shape (dict-of-dicts referencing remote files) doesn't fit the
 * MAP-of-typed-values pattern. Everything else (substitutions,
 * globals, ...) now relies on the backend describing it as a MAP
 * entry, and falls back to the YAML notice automatically when the
 * schema returns no entries.
 */
const YAML_ONLY_SECTIONS = new Set(["packages"]);

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

  /**
   * Cached `fromLine` from the navigator's emit at click time.
   * Use `_resolvedFromLine` (re-resolved against the live YAML
   * via `resolveCurrentFromLine`) for any actual operation —
   * read, save, or delete. This value goes stale as soon as
   * the YAML pane shifts, but is still useful as a "stale hint"
   * to disambiguate same-key duplicates: a small shift maps
   * the click back to the closest match.
   */
  @property({ type: Number })
  fromLine?: number;

  /**
   * Live YAML for the device — the same string the YAML pane on
   * the right shows, including any unsaved edits. Save and delete
   * operate on this rather than re-fetching from the server: the
   * navigator emits `fromLine` relative to the *live* YAML, so an
   * out-of-sync saved version would point the splice at the
   * wrong line and clobber a different section. The page that
   * owns this state (`pages/device.ts`) feeds it through
   * `device-board-info`.
   *
   * Empty / unbound values are caught at the splice site by
   * `resolveCurrentFromLine` returning `undefined` — the splice
   * never runs without a resolved `fromLine`, so an empty YAML
   * (user cleared the pane) and a missing prop binding both
   * surface as a localised section-not-found error rather than
   * an empty-string clobber.
   */
  @property()
  yaml = "";

  /** Whether the device editor's YAML pane is currently visible.
   *  When it isn't, the YAML-only notice grows a "Show YAML editor"
   *  button so the user can reach the editor in one click. */
  @property({ type: Boolean })
  yamlPaneVisible = true;

  /** Optional board metadata; used by the embedded form for PIN selectors. */
  @property({ attribute: false })
  board: BoardCatalogEntry | null = null;

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

  /** Set when `getComponent` returns null for `sectionKey` — usually
   *  a custom or external component the backend's catalog doesn't
   *  describe. We fall back to a synthetic `_config` with no entries
   *  so the existing YAML-only notice fires; the subtitle renders
   *  the `domain.platform` so the user can see which key the
   *  fallback applies to. */
  @state()
  private _isUnknown = false;

  @state()
  private _fieldErrors: Map<string, ValidationError> = new Map();

  /** Section keys for which the user has flipped on "Show advanced
   *  settings". Per-section so switching components doesn't bleed state. */
  @state()
  private _advancedShownSections = new Set<string>();

  private get _showAdvanced(): boolean {
    return this._advancedShownSections.has(this.sectionKey);
  }

  private _setShowAdvanced(show: boolean) {
    const next = new Set(this._advancedShownSections);
    if (show) next.add(this.sectionKey);
    else next.delete(this.sectionKey);
    this._advancedShownSections = next;
  }

  /** Top-level component keys present in the YAML (drives
   *  `depends_on_component` predicates). */
  @state()
  private _presentComponents: Set<string> = new Set();

  /** Section's resolved `fromLine` against the *current* yaml,
   *  recomputed each `_loadConfig`. Forwarded to the embedded
   *  form so its conflict-detection (which skips the user's
   *  own pin via `fromLine`) stays aligned with what the read
   *  + write paths see. `undefined` when the section can't be
   *  located in the live yaml — the form treats that as "no
   *  exclusion" which is the right call for a not-found
   *  section. */
  @state()
  private _resolvedFromLine?: number;

  @query("esphome-config-entry-form")
  private _form?: ESPHomeConfigEntryForm;

  @query("esphome-confirm-dialog")
  private _confirmDialog?: ESPHomeConfirmDialog;

  @state()
  private _deleting = false;

  static styles = [espHomeStyles, inputStyles, deviceSectionConfigStyles];

  updated(changedProperties: Map<string, unknown>) {
    if (
      (changedProperties.has("sectionKey") ||
        changedProperties.has("configuration") ||
        changedProperties.has("fromLine")) &&
      this.sectionKey &&
      this.configuration
    ) {
      this._loadConfig();
    }
  }

  connectedCallback() {
    super.connectedCallback();
    // Announce ourselves so the page-level navigation guard
    // (``device.ts``) can hold a direct ref. The component tree
    // is page → device-editor → device-board-info → us, three
    // shadow boundaries deep, so a property-passthrough chain
    // would cost three edits per API change. ``composed: true``
    // lets the event escape every shadow root on the way up.
    this.dispatchEvent(
      new CustomEvent("section-mount", {
        detail: { node: this },
        bubbles: true,
        composed: true,
      }),
    );
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.dispatchEvent(
      new CustomEvent("section-unmount", {
        detail: { node: this },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /** Trigger the section's save flow from outside.
   *
   *  Returns ``true`` iff the save actually succeeded —
   *  ``_onSave`` early-returns silently on validation errors
   *  (the form's ``_fieldErrors`` stamp tells the user) and on
   *  ``_resolveSpliceContext`` failure, leaving ``_dirty=true``.
   *  The page-level "Save and leave" handler awaits this and
   *  only proceeds with the section switch when the buffer is
   *  actually clean. */
  public async save(): Promise<boolean> {
    await this._onSave();
    return !this._dirty;
  }

  /**
   * Resolve the splice context for save / delete — the live YAML
   * and a current, validated `fromLine`. Sets `_error` and
   * returns `null` when the section can't be located so callers
   * surface the failure with a localised error instead of running
   * the splice with stale inputs.
   *
   * `resolveCurrentFromLine` returns `undefined` for empty /
   * unbound `this.yaml` AND for "section key no longer present
   * in the live YAML" (user pasted away the section, cleared
   * the editor, or the cached `fromLine` shifted past a
   * now-removed key). All three collapse to the same
   * user-facing error — clobbering config with an empty-string
   * splice is structurally impossible when we don't proceed
   * without a resolved line.
   *
   * Asymmetric on purpose with the read / load path: that path
   * is reactive (driven by external yaml mutation, not user
   * intent), so a popup error for "section vanished" would feel
   * intrusive — it surfaces an empty form instead. Save / delete
   * fire from an explicit user action, so an error is the right
   * acknowledgement.
   *
   * `notFoundErrorKey` is the localize key surfaced
   * (`device.save_error` / `device.section_delete_error`).
   */
  private _resolveSpliceContext(
    // Closed union so a typo at the call site (the only two
    // surfacing paths) fails to compile rather than silently
    // resolving to the locale key as English.
    notFoundErrorKey: "device.save_error" | "device.section_delete_error",
  ): { yaml: string; fromLine: number } | null {
    const fromLine = resolveCurrentFromLine(
      this.yaml,
      this.sectionKey,
      this.fromLine,
    );
    if (fromLine === undefined) {
      this._error = this._localize(notFoundErrorKey);
      return null;
    }
    return { yaml: this.yaml, fromLine };
  }

  /** Reload config from the live YAML if the form has no unsaved
   *  changes. The canonical caller is `device-board-info`'s
   *  `updated()` hook (`device-board-info.ts`, `_reloadTimer`),
   *  which debounces this against `yaml` prop changes so paste /
   *  external mutations re-seed a clean form. The dirty-check
   *  here keeps mid-edit reloads from clobbering unsaved field
   *  changes — board-info delegates the gating to us. */
  public reload() {
    if (!this._dirty && this.sectionKey && this.configuration) {
      this._loadConfig();
    }
  }

  /** Public read-only view of the unsaved-changes flag.
   *  The page-level navigation handlers (`device.ts`) consult
   *  this before mutating ``_selectedSection`` so a section
   *  switch doesn't silently clobber in-progress field edits. */
  public get dirty(): boolean {
    return this._dirty;
  }

  /** Single mutator for ``_dirty`` so a transition fires a
   *  ``dirty-change`` event the page can listen for without
   *  reaching into this component's internals. The event is
   *  cheap (one bubble per actual flip) and only emitted when
   *  the value really changes — re-saves with no edits, repeat
   *  load cycles, etc. don't churn listeners. */
  private _setDirty(value: boolean): void {
    if (this._dirty === value) return;
    this._dirty = value;
    this.dispatchEvent(
      new CustomEvent("dirty-change", {
        detail: { dirty: value },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private async _loadConfig() {
    const id = ++this._loadId;
    this._loading = true;
    this._error = "";
    this._config = null;
    this._isUnknown = false;
    this._setDirty(false);

    try {
      const platform = this.board?.esphome.platform;
      // Route through the session-scoped component cache so a
      // section that re-loads on every keystroke (e.g. driven by
      // ``editor/validate_yaml``'s post-render refresh) doesn't
      // re-issue the same backend round-trip per change. Cache
      // entries are immutable for the page's lifetime — the
      // catalog is read from a static JSON on the server.
      const component = await fetchComponent(this._api, this.sectionKey, platform);

      if (id !== this._loadId) return;

      // Use the live YAML the parent passes in; `fromLine` is
      // relative to that. A `_api.getConfig` re-fetch would
      // disagree with the user-visible YAML when the editor
      // pane has unsaved edits and seed the form from a
      // different section than the one they clicked.
      const yaml = this.yaml;

      if (!component) {
        // Custom / external component the backend doesn't know
        // about. Synthesise a config with no entries so the
        // existing YAML-only notice fires. We deliberately store
        // `sectionKey` as the title rather than a localised
        // "Custom component" label: the title flows into the
        // delete confirm dialog and toast, so a generic label
        // would make every prompt read the same when a device
        // has multiple unknown sections. The header itself is
        // re-localised live in render() — see _isUnknown branch.
        this._config = {
          section_key: this.sectionKey,
          section_type: "core",
          title: this.sectionKey,
          description: "",
          docs_url: "",
          icon: "",
          image_url: "",
          entries: [],
        };
        this._isUnknown = true;
      } else {
        this._config = {
          section_key: this.sectionKey,
          section_type: "core",
          title: component.name,
          description: component.description,
          docs_url: component.docs_url,
          icon: "",
          image_url: component.image_url,
          entries: component.config_entries,
        };
      }
      // Resolve `fromLine` against the live YAML — see
      // `_resolveSpliceContext` for the contract and the
      // documented asymmetry between this read path
      // (silent-empty on missing section) and the save / delete
      // paths (localised error). When the resolver returns
      // `undefined`, the parser's column-0 scan won't match a
      // dotted platform key, so values come back `{}` and the
      // form surfaces empty.
      const resolvedFromLine = resolveCurrentFromLine(
        yaml,
        this.sectionKey,
        this.fromLine,
      );
      this._values = parseYamlSectionValues(
        yaml,
        this.sectionKey,
        resolvedFromLine,
      );
      this._resolvedFromLine = resolvedFromLine;
      this._presentComponents = parseTopLevelComponents(yaml);
    } catch (e) {
      if (id !== this._loadId) return;
      const msg = e instanceof Error ? e.message : "";
      this._error = msg.includes("timed out")
        ? this._localize("device.load_config_error")
        : msg || this._localize("device.load_config_error");
    } finally {
      if (id === this._loadId) {
        this._loading = false;
      }
    }
  }

  private _onImageError(e: Event) {
    const img = e.target as HTMLImageElement;
    const fallback = "/assets/board/default.svg";
    if (
      img.src !== window.location.origin + fallback &&
      !img.src.endsWith(fallback)
    ) {
      img.src = fallback;
    }
  }

  protected render() {
    if (this._loading) {
      return html`<div class="loading"><wa-spinner></wa-spinner></div>`;
    }

    if (this._error && !this._config) {
      return html`<p class="error">${this._error}</p>`;
    }

    if (!this._config) return nothing;

    const showAdvanced = this._showAdvanced;
    // ``resolveSectionEntries`` handles overrides for sections
    // whose backend schema doesn't match the actual user-keyed
    // shape (currently just ``substitutions``); see the helper's
    // docstring for the rationale + the failure mode it pins.
    const renderEntries = resolveSectionEntries(
      this.sectionKey,
      this._config.entries,
    );
    const hasAdvanced = anyAdvancedEntry(renderEntries);
    // Free-form / structural sections: show the description + a
    // "edit via YAML" notice instead of attempting to render the form.
    // We force this for `packages` (where any schema the backend
    // returns won't match the actual list / dict shape) and also
    // fall back to it for any section that happens to come back
    // with no entries at all.
    const yamlOnly =
      YAML_ONLY_SECTIONS.has(this.sectionKey) ||
      renderEntries.length === 0;

    const canDelete = !UNDELETABLE_SECTIONS.has(this.sectionKey);

    return html`
      <div class="section-header">
        <div class="section-header-info">
          <div class="section-header-title-row">
            <h3 class="section-title">
              ${this._isUnknown
                ? this._localize("device.custom_component_title")
                : this._config.title}
            </h3>
            ${this._config.docs_url
              ? html`<a
                  class="docs-link"
                  href=${this._config.docs_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  ${this._localize("device.docs")}
                  <wa-icon library="mdi" name="open-in-new"></wa-icon>
                </a>`
              : nothing}
          </div>
          ${this._isUnknown
            ? html`<p class="section-subtitle">${this.sectionKey}</p>`
            : nothing}
          ${this._config.description
            ? html`<p class="section-desc">
                ${renderMarkdown(this._config.description)}
              </p>`
            : nothing}
        </div>
        ${this._isUnknown
          ? nothing
          : html`<div class="section-image">
              <img
                src=${this._config.image_url || "/assets/board/default.svg"}
                alt=${this._config.title}
                referrerpolicy="no-referrer"
                @error=${this._onImageError}
              />
            </div>`}
      </div>
      ${yamlOnly
        ? html`<div class="yaml-only-notice" role="note">
              <wa-icon library="mdi" name="information-outline"></wa-icon>
              <div class="yaml-only-notice-body">
                <p>${this._localize("device.yaml_only_section")}</p>
                ${this.yamlPaneVisible
                  ? nothing
                  : html`<button
                      type="button"
                      class="yaml-only-notice-cta"
                      @click=${this._onShowYamlEditor}
                    >
                      ${this._localize("device.show_yaml_editor")}
                    </button>`}
              </div>
            </div>
            ${canDelete
              ? html`<div class="actions">
                  ${this._renderDeleteButton()}
                </div>`
              : nothing}`
        : html`
            <esphome-config-entry-form
              .entries=${renderEntries}
              .values=${this._values}
              .errors=${this._fieldErrors}
              .board=${this.board}
              .yaml=${this.yaml}
              .fromLine=${this._resolvedFromLine}
              .presentComponents=${this._presentComponents}
              ?disabled=${this._saving}
              ?show-advanced=${showAdvanced}
              @value-change=${this._onValueChange}
            ></esphome-config-entry-form>
            ${hasAdvanced
              ? html`<div class="advanced-toggle-row">
                  <wa-switch
                    ?checked=${showAdvanced}
                    @change=${(e: Event) =>
                      this._setShowAdvanced(
                        (
                          e.target as HTMLInputElement & {
                            checked: boolean;
                          }
                        ).checked,
                      )}
                  >
                    ${this._localize("device.show_advanced")}
                  </wa-switch>
                </div>`
              : nothing}
            ${this._error
              ? html`<p class="error">${this._error}</p>`
              : nothing}
            <div class="actions">
              ${canDelete ? this._renderDeleteButton() : nothing}
              <button
                class="save-button"
                ?disabled=${this._saving || !this._dirty}
                @click=${this._onSave}
              >
                <wa-icon library="mdi" name="content-save"></wa-icon>
                ${this._saving
                  ? this._localize("device.saving")
                  : this._localize("device.save")}
              </button>
            </div>
          `}
      ${canDelete
        ? html`<esphome-confirm-dialog
            heading=${this._localize("device.delete_section")}
            confirm-label=${this._localize("device.delete_section")}
            message=${this._localize("device.confirm_delete_section", {
              name: this._config.title,
            })}
            destructive
            @confirm=${this._onDeleteConfirmed}
          ></esphome-confirm-dialog>`
        : nothing}
    `;
  }

  private _renderDeleteButton() {
    return html`<button
      class="delete-button"
      ?disabled=${this._saving || this._deleting}
      @click=${this._onDeleteClick}
    >
      <wa-icon library="mdi" name="delete"></wa-icon>
      ${this._localize("device.delete_section")}
    </button>`;
  }

  private _onDeleteClick() {
    this._confirmDialog?.open();
  }

  private async _onDeleteConfirmed() {
    if (!this._config) return;
    const ctx = this._resolveSpliceContext("device.section_delete_error");
    if (!ctx) return;
    this._deleting = true;
    this._error = "";
    const title = this._config.title;
    try {
      const newYaml = removeSectionFromYaml(
        ctx.yaml,
        this.sectionKey,
        ctx.fromLine,
      );
      if (newYaml === ctx.yaml) {
        this._error = this._localize("device.section_delete_error");
        return;
      }
      await this._api.updateConfig(this.configuration, newYaml);
      this._setDirty(false);
      this.dispatchEvent(
        new CustomEvent("yaml-updated", {
          detail: { yaml: newYaml },
          bubbles: true,
          composed: true,
        }),
      );
      this.dispatchEvent(
        new CustomEvent("section-select", {
          detail: { sectionKey: null },
          bubbles: true,
          composed: true,
        }),
      );
      toast.success(this._localize("device.section_deleted", { name: title }), {
        richColors: true,
      });
    } catch (e) {
      this._error =
        e instanceof Error
          ? e.message
          : this._localize("device.section_delete_error");
    } finally {
      this._deleting = false;
    }
  }

  private _onShowYamlEditor() {
    this.dispatchEvent(
      new CustomEvent("show-yaml-editor", {
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _onValueChange(e: CustomEvent<ConfigEntryValueChange>) {
    const { path, value } = e.detail;
    this._values = setIn(this._values, path, value);
    this._setDirty(true);
    const errKey = path.join(".");
    if (this._fieldErrors.has(errKey)) {
      const next = new Map(this._fieldErrors);
      next.delete(errKey);
      this._fieldErrors = next;
    }
  }

  private async _scrollFirstErrorIntoView(
    errors: Map<string, ValidationError>,
  ) {
    if (!this._config) return;

    const firstHit = findFirstErrorTarget(this._config.entries, errors);
    if (!firstHit) return;
    const { path, hasAdvancedAncestor } = firstHit;

    if (hasAdvancedAncestor && !this._showAdvanced) {
      this._setShowAdvanced(true);
      await this.updateComplete;
    }

    // Open every parent NESTED group on the form so the failing field
    // is actually rendered when we go to find it.
    if (path.length > 1) {
      for (let i = 1; i < path.length; i++) {
        this._form?.openNested(path.slice(0, i).join("."));
      }
      await this.updateComplete;
      await this._form?.updateComplete;
    }

    const root = this._form?.shadowRoot;
    if (!root) return;
    const container = root.querySelector(
      `[data-field-key="${CSS.escape(path.join("."))}"]`,
    ) as HTMLElement | null;
    if (!container) return;

    container.scrollIntoView({ behavior: "smooth", block: "center" });
    const focusable = container.querySelector<HTMLElement>(
      "input, select, textarea, wa-select, wa-switch, [tabindex]",
    );
    focusable?.focus({ preventScroll: true });
  }

  private async _onSave() {
    if (!this._config) return;
    // Validate against the *render* schema, not the raw catalog.
    // For sections in ``MAP_SECTIONS`` (substitutions / packages /
    // …) the catalog ships an irrelevant flat schema (9 specific
    // fields for ``packages:``, one bogus ``string`` for
    // ``substitutions:``) that does not match what the user
    // actually edits in the form. ``resolveSectionEntries``
    // produces the synthesised user-keyed-MAP shape; validating
    // against the catalog instead would (e.g.) reject a
    // ``packages:`` save because the catalog's required ``url``
    // field isn't present in the user-named row, and the form
    // would silently bail (Save click "does nothing") because
    // ``_fieldErrors`` lives on entries the renderer never
    // surfaces. Use the same entries the form rendered.
    const renderEntries = resolveSectionEntries(
      this.sectionKey,
      this._config.entries,
    );
    const errors = validateEntries(
      renderEntries,
      this._values,
      this._presentComponents,
    );
    if (errors.size > 0) {
      this._fieldErrors = errors;
      await this.updateComplete;
      this._scrollFirstErrorIntoView(errors);
      return;
    }
    this._fieldErrors = new Map();
    const ctx = this._resolveSpliceContext("device.save_error");
    if (!ctx) return;
    this._saving = true;
    this._error = "";
    try {
      const newYaml = updateSectionInYaml(
        ctx.yaml,
        this.sectionKey,
        this._values,
        ctx.fromLine,
        // Top-level user-keyed sections (``substitutions:``)
        // must persist explicit ``""`` values — the user typed
        // a key + cleared the value, that's intentional data.
        // For ordinary sections the default drops ``""`` to
        // mean "user cleared the field"; the override only
        // flips the contract for ``MAP_SECTIONS``. (Copilot:
        // empty-string substitutions were silently dropped on
        // any save.)
        { keepEmptyStrings: MAP_SECTIONS.has(this.sectionKey) },
      );
      const title = this._config.title;
      this._api.updateConfig(this.configuration, newYaml).catch((e) => {
        this._error =
          e instanceof Error ? e.message : this._localize("device.save_error");
      });
      this._setDirty(false);
      this.dispatchEvent(
        new CustomEvent("yaml-updated", {
          detail: { yaml: newYaml },
          bubbles: true,
          composed: true,
        }),
      );
      toast.success(this._localize("device.section_saved_toast", { title }), {
        richColors: true,
      });
    } catch (e) {
      this._error =
        e instanceof Error ? e.message : this._localize("device.save_error");
    } finally {
      this._saving = false;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-device-section-config": ESPHomeDeviceSectionConfig;
  }
}
