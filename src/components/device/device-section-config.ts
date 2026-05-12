import { consume } from "@lit/context";
import {
  mdiDelete,
  mdiInformationOutline,
  mdiOpenInNew,
} from "@mdi/js";
import { html, LitElement, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { ESPHomeAPI } from "../../api/index.js";
import type { BoardCatalogEntry } from "../../api/types.js";
import { resolveSectionEntries } from "../../util/section-entry-overrides.js";
import { withBase } from "../../util/base-path.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { apiContext, localizeContext } from "../../context/index.js";
import { inputStyles } from "../../styles/inputs.js";
import { espHomeStyles } from "../../styles/shared.js";
import { anyAdvancedEntry } from "../../util/config-entry-tree.js";
import type { ValidationError } from "../../util/config-validation.js";
import { renderMarkdown } from "../../util/markdown.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { isYamlOnlySection } from "./yaml-only-sections.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/spinner/spinner.js";
import "@home-assistant/webawesome/dist/components/switch/switch.js";
import "../confirm-dialog.js";
import type { ESPHomeConfirmDialog } from "../confirm-dialog.js";
import "./config-entry-form.js";
import type { ConfigEntryValueChange } from "./config-entry-form.js";
import { deviceSectionConfigStyles } from "./device-section-config.styles.js";
import {
  loadConfig,
  type SectionConfigResponse,
} from "./device-section-config/loading.js";
import {
  flushDraft,
  onDeleteConfirmed,
  onValueChange,
} from "./device-section-config/draft-and-delete.js";

registerMdiIcons({
  delete: mdiDelete,
  "information-outline": mdiInformationOutline,
  "open-in-new": mdiOpenInNew,
});

// esphome: is the device identity block — required to compile. Hide delete
// to prevent the user accidentally bricking the file in one click.
const UNDELETABLE_SECTIONS = new Set(["esphome"]);

@customElement("esphome-device-section-config")
export class ESPHomeDeviceSectionConfig extends LitElement {
  @consume({ context: localizeContext, subscribe: true }) @state() _localize: LocalizeFunc = (key) => key;
  @consume({ context: apiContext }) _api!: ESPHomeAPI;

  @property() configuration = "";
  @property() sectionKey = "";

  // Cached fromLine from the navigator's click. _resolvedFromLine (re-resolved
  // against live YAML) is what reads/saves/deletes use. This goes stale on
  // YAML shifts but stays useful as a "stale hint" to disambiguate same-key
  // duplicates — a small shift maps the click back to the closest match.
  @property({ type: Number }) fromLine?: number;

  // Same string the YAML pane shows including unsaved edits. Save and delete
  // operate on this rather than re-fetching: the navigator emits fromLine
  // relative to live YAML, so an out-of-sync version would point the splice
  // at the wrong line. Empty values caught by resolveCurrentFromLine.
  @property() yaml = "";

  // Whether the device editor's YAML pane is currently visible — when not,
  // the YAML-only notice surfaces a "Show YAML editor" CTA.
  @property({ type: Boolean }) yamlPaneVisible = true;

  @property({ attribute: false }) board: BoardCatalogEntry | null = null;

  @state() _config: SectionConfigResponse | null = null;
  @state() _values: Record<string, unknown> = {};
  @state() _loading = false;
  @state() _dirty = false;
  @state() _error = "";

  // Custom / external component the backend catalog doesn't describe —
  // synthetic empty-entries _config triggers the YAML-only notice; subtitle
  // shows the domain.platform so the user can see which key it applies to.
  @state() _isUnknown = false;

  @state() _fieldErrors: Map<string, ValidationError> = new Map();

  // Per-section so switching components doesn't bleed state.
  @state() _advancedShownSections = new Set<string>();
  @state() _presentComponents: Set<string> = new Set();

  // Section's resolved fromLine against the *current* yaml. Forwarded to the
  // form so its conflict-detection stays aligned with read/write paths.
  // undefined when not found — form treats that as "no exclusion".
  @state() _resolvedFromLine?: number;

  @query("esphome-confirm-dialog") _confirmDialog?: ESPHomeConfirmDialog;

  @state() _deleting = false;

  _loadId = 0;
  _draftTimer: ReturnType<typeof setTimeout> | null = null;
  // Parent loops yaml-draft events back through our yaml prop, which would
  // trigger reload() and lose focus mid-edit. reload() short-circuits when
  // the live yaml matches this snapshot.
  _lastSelfWrittenYaml: string | null = null;

  // 200ms is short enough that the YAML pane feels live as the user moves
  // between fields, long enough to coalesce typing into one splice.
  private static readonly DRAFT_DEBOUNCE_MS = 200;

  private get _showAdvanced(): boolean {
    return this._advancedShownSections.has(this.sectionKey);
  }

  private _setShowAdvanced(show: boolean) {
    const next = new Set(this._advancedShownSections);
    if (show) next.add(this.sectionKey);
    else next.delete(this.sectionKey);
    this._advancedShownSections = next;
  }

  static styles = [espHomeStyles, inputStyles, deviceSectionConfigStyles];

  updated(changedProperties: Map<string, unknown>) {
    if (
      (changedProperties.has("sectionKey") ||
        changedProperties.has("configuration") ||
        changedProperties.has("fromLine")) &&
      this.sectionKey &&
      this.configuration
    ) {
      void loadConfig(this);
    }
  }

  connectedCallback() {
    super.connectedCallback();
    // Announce so the page-level navigation guard (device.ts) can hold a
    // direct ref. The tree is page → device-editor → device-board-info → us;
    // a property passthrough chain would cost three edits per API change.
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

  // Flush pending draft sync now. The page calls this before save / section
  // switch / leave so the user's last keystroke isn't lost in the debounce.
  // Dispatches yaml-draft synchronously so callers reading page._yaml on
  // the next line see the up-to-date value.
  public flushPending(): void {
    if (this._draftTimer === null) return;
    clearTimeout(this._draftTimer);
    this._draftTimer = null;
    flushDraft(this);
  }

  // Reload config from live YAML. Two skip cases: (a) yaml exactly matches
  // what we wrote in _flushDraft (reload would re-parse our own write and
  // lose field focus), (b) a debounced flush is pending (form is mid-edit,
  // don't overwrite in-flight keystrokes).
  public reload() {
    if (!this.sectionKey || !this.configuration) return;
    if (this._draftTimer !== null) return;
    if (this.yaml === this._lastSelfWrittenYaml) return;
    void loadConfig(this);
  }

  public get dirty(): boolean {
    return this._dirty;
  }

  // Single mutator so transitions fire dirty-change events the page can
  // listen for without reaching into internals. Only emits on real flips.
  _setDirty(value: boolean): void {
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

  _scheduleDraftFlush() {
    if (this._draftTimer) clearTimeout(this._draftTimer);
    this._draftTimer = setTimeout(
      () => flushDraft(this),
      ESPHomeDeviceSectionConfig.DRAFT_DEBOUNCE_MS,
    );
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

  private _onShowYamlEditor() {
    this.dispatchEvent(
      new CustomEvent("show-yaml-editor", { bubbles: true, composed: true }),
    );
  }

  private _onValueChange = (e: CustomEvent<ConfigEntryValueChange>) =>
    onValueChange(this, e);

  private _onDeleteConfirmed = () => onDeleteConfirmed(this);

  protected render() {
    if (this._loading) {
      return html`<div class="loading"><wa-spinner></wa-spinner></div>`;
    }

    if (this._error && !this._config) {
      return html`<p class="error">${this._error}</p>`;
    }

    if (!this._config) return nothing;

    const showAdvanced = this._showAdvanced;
    // Handles overrides for sections whose backend schema doesn't match the
    // actual user-keyed shape (currently just substitutions).
    const renderEntries = resolveSectionEntries(
      this.sectionKey,
      this._config.entries,
    );
    const hasAdvanced = anyAdvancedEntry(renderEntries);
    // Free-form / structural sections: show "edit via YAML" instead of the
    // form. external_components and packages are always-YAML (discriminated
    // unions don't fit the catalog — see #361 for the packages data-loss
    // regression). Zero-entries sections also fall back here.
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
              ? html`<div class="actions">${this._renderDeleteButton()}</div>`
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
                        (e.target as HTMLInputElement & { checked: boolean }).checked,
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
              ? html`<div class="actions">${this._renderDeleteButton()}</div>`
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
      @click=${() => this._confirmDialog?.open()}
    >
      <wa-icon library="mdi" name="delete"></wa-icon>
      ${this._localize("device.delete_section")}
    </button>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-device-section-config": ESPHomeDeviceSectionConfig;
  }
}
