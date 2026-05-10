import { consume } from "@lit/context";
import {
  mdiDelete,
  mdiInformationOutline,
  mdiOpenInNew,
} from "@mdi/js";
import { html, LitElement, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import toast from "sonner-js";
import type { ESPHomeAPI } from "../../api/index.js";
import type {
  BoardCatalogEntry,
  ConfigEntry,
} from "../../api/types.js";
import {
  KEEP_EMPTY_STRING_SECTIONS,
  resolveSectionEntries,
} from "../../util/section-entry-overrides.js";
import { withBase } from "../../util/base-path.js";
import { fetchComponent } from "../../util/component-name-cache.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { apiContext, localizeContext } from "../../context/index.js";
import { inputStyles } from "../../styles/inputs.js";
import { espHomeStyles } from "../../styles/shared.js";
import { anyAdvancedEntry } from "../../util/config-entry-tree.js";
import {
  validateEntries,
  type ValidationError,
} from "../../util/config-validation.js";
import { normalizeHexValues } from "../../util/hex-int.js";
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
import { isYamlOnlySection } from "./yaml-only-sections.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/spinner/spinner.js";
import "@home-assistant/webawesome/dist/components/switch/switch.js";
import "../confirm-dialog.js";
import type { ESPHomeConfirmDialog } from "../confirm-dialog.js";
import "./config-entry-form.js";
import type { ConfigEntryValueChange } from "./config-entry-form.js";
import { deviceSectionConfigStyles } from "./device-section-config.styles.js";

registerMdiIcons({
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

// YAML-only-section gate lives in ``yaml-only-sections.ts`` so the
// unit test can import it without pulling Lit / DOM through here.

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
  private _dirty = false;

  private _loadId = 0;

  /** Pending debounce for auto-syncing form edits into the draft
   *  YAML. Cleared on flush, on unmount, and when the section
   *  reloads. */
  private _draftTimer: ReturnType<typeof setTimeout> | null = null;

  /** Last YAML the form wrote to itself via auto-sync. The parent
   *  pipes our `yaml-draft` events back into our `yaml` prop, which
   *  would otherwise trigger ``device-board-info``'s reload-on-yaml-
   *  change debounce (`reload()`); reload would briefly flip
   *  `_loading` and re-parse values into the form, costing the active
   *  field its focus mid-edit. ``reload()`` short-circuits when this
   *  matches the live yaml. */
  private _lastSelfWrittenYaml: string | null = null;

  /** Debounce window for syncing form values into the draft YAML.
   *  Short enough that the YAML pane updates feel live as the user
   *  moves between fields, long enough to coalesce typing within a
   *  single field into one splice + re-render. */
  private static readonly DRAFT_DEBOUNCE_MS = 200;

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
    if (this._draftTimer) {
      clearTimeout(this._draftTimer);
      this._draftTimer = null;
    }
    this.dispatchEvent(
      new CustomEvent("section-unmount", {
        detail: { node: this },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /** Flush any pending draft sync immediately. Called by the page
   *  before saving / switching sections / leaving the page so the
   *  user's last keystroke isn't lost in the debounce window. Safe
   *  to call when no flush is pending — no-op. The flush dispatches
   *  ``yaml-draft`` synchronously, so callers that read
   *  ``page._yaml`` on the next line see the up-to-date value. */
  public flushPending(): void {
    if (this._draftTimer === null) return;
    clearTimeout(this._draftTimer);
    this._draftTimer = null;
    this._flushDraft();
  }

  /** Resolve the splice context for delete — the live YAML and a
   *  current, validated `fromLine`. Sets `_error` and returns `null`
   *  when the section can't be located so callers surface the
   *  failure with a localised error instead of running the splice
   *  with stale inputs.
   *
   *  `resolveCurrentFromLine` returns `undefined` for empty /
   *  unbound `this.yaml` AND for "section key no longer present in
   *  the live YAML" (user pasted away the section, cleared the
   *  editor, or the cached `fromLine` shifted past a now-removed
   *  key). All three collapse to the same user-facing error —
   *  clobbering config with an empty-string splice is structurally
   *  impossible when we don't proceed without a resolved line.
   *
   *  Asymmetric on purpose with the read / load path: that path is
   *  reactive (driven by external yaml mutation, not user intent),
   *  so a popup error for "section vanished" would feel intrusive
   *  — it surfaces an empty form instead. Delete fires from an
   *  explicit user action, so an error is the right
   *  acknowledgement.
   */
  private _resolveDeleteContext(): { yaml: string; fromLine: number } | null {
    const fromLine = resolveCurrentFromLine(
      this.yaml,
      this.sectionKey,
      this.fromLine,
    );
    if (fromLine === undefined) {
      this._error = this._localize("device.section_delete_error");
      return null;
    }
    return { yaml: this.yaml, fromLine };
  }

  /** Reload config from the live YAML.
   *
   *  Two skip cases:
   *  - the live yaml exactly matches what we just wrote ourselves
   *    via ``_flushDraft`` (the parent loops the draft event back
   *    through our ``yaml`` prop). Reloading would re-parse our
   *    own write and rebuild ``_values`` — observable as a brief
   *    spinner flash and a focus loss on whichever field the user
   *    is still editing.
   *  - a debounced flush is pending. The form is mid-edit; let it
   *    flush first so the user's in-flight keystrokes aren't
   *    overwritten by the now-stale yaml.
   *
   *  Canonical caller is ``device-board-info``'s ``updated()`` hook
   *  (``_reloadTimer``), which debounces this against ``yaml`` prop
   *  changes so paste / external mutations re-seed a clean form. */
  public reload() {
    if (!this.sectionKey || !this.configuration) return;
    if (this._draftTimer !== null) return;
    if (this.yaml === this._lastSelfWrittenYaml) return;
    this._loadConfig();
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
    if (this._draftTimer) {
      clearTimeout(this._draftTimer);
      this._draftTimer = null;
    }
    this._lastSelfWrittenYaml = null;

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
      const parsedValues = parseYamlSectionValues(
        yaml,
        this.sectionKey,
        resolvedFromLine,
      );
      // Pre-format hex-typed numeric values to their canonical
      // ``"0x..."`` string form (issue #410) so a save preserves
      // the user's hex notation even when they only edited an
      // unrelated field. The serializer is schema-agnostic and
      // emits numbers verbatim, so without this an i2c address
      // round-trips from ``0x76`` to ``118`` on the next save.
      this._values = normalizeHexValues(parsedValues, this._config.entries);
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
    const fallback = withBase("/assets/board/default.svg");
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
    // "edit via YAML" notice instead of attempting to render the
    // form. ``external_components`` and ``packages`` are the
    // always-YAML cases (the discriminated unions in their
    // schemas don't fit the catalog model — see #361 for the
    // ``packages`` data-loss regression that led to it); any
    // section with zero entries also falls back here.
    const yamlOnly = isYamlOnlySection(this.sectionKey, renderEntries.length);

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
                src=${this._config.image_url || withBase("/assets/board/default.svg")}
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
              ?show-advanced=${showAdvanced}
              @value-change=${this._onValueChange}
            ></esphome-config-entry-form>
            ${hasAdvanced
              ? html`<div class="advanced-toggle-row">
                  <wa-switch
                    .checked=${showAdvanced}
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
            ${canDelete
              ? html`<div class="actions">
                  ${this._renderDeleteButton()}
                </div>`
              : nothing}
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
      ?disabled=${this._deleting}
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
    const ctx = this._resolveDeleteContext();
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
    this._scheduleDraftFlush();
  }

  private _scheduleDraftFlush() {
    if (this._draftTimer) clearTimeout(this._draftTimer);
    this._draftTimer = setTimeout(
      () => this._flushDraft(),
      ESPHomeDeviceSectionConfig.DRAFT_DEBOUNCE_MS,
    );
  }

  /** Splice the current form ``_values`` into the draft YAML and
   *  emit ``yaml-draft`` so the page updates ``_yaml`` (NOT
   *  ``_savedYaml`` — the right-pane Save button is the only path
   *  that commits to disk).
   *
   *  Surfaces validation errors inline via ``_fieldErrors`` but
   *  still splices when invalid: the YAML pane is the source of
   *  truth for "what would be saved" and hiding partial edits there
   *  would confuse a user who expects to see their changes show up.
   *  Genuine YAML / ESPHome validity is enforced by the existing
   *  red-squiggle lint on the YAML pane and by the explicit Validate
   *  button. */
  private _flushDraft() {
    this._draftTimer = null;
    if (!this._config) return;

    // Validate against the *render* schema, not the raw catalog.
    // For sections in ``MAP_SECTIONS`` (substitutions / packages /
    // …) the catalog ships an irrelevant flat schema that does not
    // match what the user actually edits in the form.
    // ``resolveSectionEntries`` produces the synthesised user-keyed-
    // MAP shape; using the catalog instead would surface phantom
    // "missing required field" errors (e.g. ``packages.url``) on
    // every keystroke.
    const renderEntries = resolveSectionEntries(
      this.sectionKey,
      this._config.entries,
    );
    this._fieldErrors = validateEntries(
      renderEntries,
      this._values,
      this._presentComponents,
      this.board?.esphome.platform ?? null,
    );

    const fromLine = resolveCurrentFromLine(
      this.yaml,
      this.sectionKey,
      this.fromLine,
    );
    if (fromLine === undefined) {
      // Section was removed from the live YAML between the user's
      // keystroke and our debounce firing (paste / external edit).
      // Drop the splice silently — the next time the user picks
      // this section in the navigator, ``_loadConfig`` will rebuild
      // from whatever's in YAML now.
      this._setDirty(false);
      return;
    }

    const newYaml = updateSectionInYaml(
      this.yaml,
      this.sectionKey,
      this._values,
      fromLine,
      // Substitutions-only contract: the user typed a key +
      // cleared the value, that's intentional data and must
      // round-trip. Other MAP sections (``packages``) treat an
      // empty value as a placeholder row the user hasn't filled in
      // yet — the YAML would still be syntactically valid, but
      // ESPHome's ``packages:`` schema validator rejects an empty-
      // string package definition, so dropping the placeholder row
      // keeps the saved config loadable.
      { keepEmptyStrings: KEEP_EMPTY_STRING_SECTIONS.has(this.sectionKey) },
    );

    this._setDirty(false);

    if (newYaml === this.yaml) return;

    this._lastSelfWrittenYaml = newYaml;
    this.dispatchEvent(
      new CustomEvent("yaml-draft", {
        detail: { yaml: newYaml },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-device-section-config": ESPHomeDeviceSectionConfig;
  }
}
