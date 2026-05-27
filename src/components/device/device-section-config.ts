import { consume } from "@lit/context";
import {
  mdiDelete,
  mdiInformationOutline,
  mdiOpenInNew,
  mdiPencil,
  mdiPlusCircleOutline,
} from "@mdi/js";
import { html, LitElement, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import toast from "sonner-js";
import type { ESPHomeAPI } from "../../api/index.js";
import type { AutomationLocation, BoardCatalogEntry } from "../../api/types.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { apiContext, localizeContext } from "../../context/index.js";
import { inputStyles } from "../../styles/inputs.js";
import { espHomeStyles } from "../../styles/shared.js";
import { withBase } from "../../util/base-path.js";
import { anyAdvancedEntry } from "../../util/config-entry-tree.js";
import type { ValidationError } from "../../util/config-validation.js";
import { renderMarkdown } from "../../util/markdown.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { resolveSectionEntries } from "../../util/section-entry-overrides.js";
import {
  parseYamlAutomations,
  parseYamlTopLevelSections,
  sectionKeyOf,
} from "../../util/yaml-sections.js";
import { applyYamlDiff } from "./automation-editor/serialise.js";
import { isYamlOnlySection } from "./yaml-only-sections.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/spinner/spinner.js";
import "@home-assistant/webawesome/dist/components/switch/switch.js";
import "../confirm-dialog.js";
import type { ESPHomeConfirmDialog } from "../confirm-dialog.js";
import "./add-api-action-dialog.js";
import type { ESPHomeAddApiActionDialog } from "./add-api-action-dialog.js";
import "./add-automation-dialog.js";
import type { ESPHomeAddAutomationDialog } from "./add-automation-dialog.js";
import "./config-entry-form.js";
import type { ConfigEntryValueChange } from "./config-entry-form.js";
import { deviceSectionConfigStyles } from "./device-section-config.styles.js";
import {
  flushDraft,
  onDeleteConfirmed,
  onValueChange,
} from "./device-section-config/draft-and-delete.js";
import {
  loadConfig,
  type SectionConfigResponse,
} from "./device-section-config/loading.js";

registerMdiIcons({
  delete: mdiDelete,
  "information-outline": mdiInformationOutline,
  "open-in-new": mdiOpenInNew,
  pencil: mdiPencil,
  "plus-circle-outline": mdiPlusCircleOutline,
});

// esphome: is the device identity block — required to compile. Hide delete
// to prevent the user accidentally bricking the file in one click.
const UNDELETABLE_SECTIONS = new Set(["esphome"]);

@customElement("esphome-device-section-config")
export class ESPHomeDeviceSectionConfig extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  _localize: LocalizeFunc = (key) => key;
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

  /** Human-readable board name ("Athom Smart Plug v3"). Forwarded
   *  to per-section dialogs (e.g. the api section's add-action
   *  dialog) so their titles read as "New X for <device>" rather
   *  than falling back to the section's own title. */
  @property() boardName = "";

  @state() _config: SectionConfigResponse | null = null;
  @state() _values: Record<string, unknown> = {};
  @state() _loading = false;
  @state() _dirty = false;
  @state() _error = "";

  /** Inline delete in flight against the api-actions list. Disables
   *  the table while we wait so the user can't fire a second delete
   *  before the first applies. */
  @state() _deletingApiAction = "";

  /** Inline delete in flight against the per-component triggers
   *  list. Same role as ``_deletingApiAction`` (and same table-wide
   *  lock — one delete at a time, all rows disabled while it's in
   *  flight) but for the ``component_on`` / ``device_on`` shortcut
   *  surface. Held as the trigger's stable section key
   *  (``automation:component_on:<id>:on_press`` or
   *  ``automation:device_on:on_boot``) so the value is informative
   *  for debugging / future per-row spinner UI; the lock itself is
   *  the empty / non-empty boolean. */
  @state() _deletingTrigger = "";

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
  @query("esphome-add-api-action-dialog")
  _addApiActionDialog?: ESPHomeAddApiActionDialog;
  @query("esphome-add-automation-dialog")
  _addAutomationDialog?: ESPHomeAddAutomationDialog;

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
      })
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
      })
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
      })
    );
  }

  _scheduleDraftFlush() {
    if (this._draftTimer) clearTimeout(this._draftTimer);
    this._draftTimer = setTimeout(
      () => flushDraft(this),
      ESPHomeDeviceSectionConfig.DRAFT_DEBOUNCE_MS
    );
  }

  private _onImageError(e: Event) {
    const img = e.target as HTMLImageElement;
    const fallback = withBase("/assets/board/default.svg");
    if (img.src !== window.location.origin + fallback && !img.src.endsWith(fallback)) {
      img.src = fallback;
    }
  }

  private _onShowYamlEditor() {
    this.dispatchEvent(
      new CustomEvent("show-yaml-editor", { bubbles: true, composed: true })
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
    const renderEntries = resolveSectionEntries(this.sectionKey, this._config.entries);
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
            ${this._renderApiActionsTable()} ${this._renderTriggersTable()}
            ${this._renderActionsRow(canDelete)}`
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
                        (e.target as HTMLInputElement & { checked: boolean }).checked
                      )}
                  >
                    ${this._localize("device.show_advanced")}
                  </wa-switch>
                </div>`
              : nothing}
            ${this._error ? html`<p class="error">${this._error}</p>` : nothing}
            ${this._renderApiActionsTable()} ${this._renderTriggersTable()}
            ${this._renderActionsRow(canDelete)}
          `}
      ${this._renderApiActionDialog()} ${this._renderAddAutomationDialog()}
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

  /**
   * Inline manage-list of api_action entries. Rendered only for the
   * api section; surfaces existing actions as a flat table with
   * edit (route to the inline editor) and delete (splice via the
   * backend) per row. Hidden entirely when no actions are
   * declared — the `+ Add API action` button next to Delete is
   * the entry point in that case.
   */
  private _renderApiActionsTable() {
    if (this.sectionKey !== "api") return nothing;
    const items = parseYamlAutomations(this.yaml).filter((s) =>
      s.key.startsWith("automation:api_action:")
    );
    // One delete is in flight at a time; lock the whole table so
    // the user can't fire a second delete (or jump into the editor
    // on a sibling row) before the first round-trip settles.
    const locked = this._deletingApiAction !== "";
    return html`<div class="api-actions-table">
      <div class="api-actions-header">
        <h4 class="api-actions-title">
          ${this._localize("device.api_actions_list_title")}
        </h4>
        <button type="button" class="api-actions-add" @click=${this._onOpenAddApiAction}>
          <wa-icon library="mdi" name="plus"></wa-icon>
          ${this._localize("device.add_api_action")}
        </button>
      </div>
      ${items.length === 0
        ? html`<p class="api-actions-empty" role="status">
            ${this._localize("device.api_actions_list_empty")}
          </p>`
        : html`<ul class="api-actions-rows">
            ${items.map(
              (item) =>
                html`<li class="api-actions-row">
                  <span class="api-actions-name">${item.id}</span>
                  <div class="api-actions-row-buttons">
                    <button
                      type="button"
                      class="api-actions-row-edit"
                      aria-label=${this._localize("device.api_actions_list_edit")}
                      title=${this._localize("device.api_actions_list_edit")}
                      ?disabled=${locked}
                      @click=${() => this._onEditApiAction(item.key)}
                    >
                      <wa-icon library="mdi" name="pencil"></wa-icon>
                    </button>
                    <button
                      type="button"
                      class="api-actions-row-delete"
                      aria-label=${this._localize("device.api_actions_list_delete")}
                      title=${this._localize("device.api_actions_list_delete")}
                      ?disabled=${locked}
                      @click=${() => this._onDeleteApiAction(item.id ?? "")}
                    >
                      <wa-icon library="mdi" name="delete"></wa-icon>
                    </button>
                  </div>
                </li>`
            )}
          </ul>`}
    </div>`;
  }

  private _renderActionsRow(canDelete: boolean) {
    if (!canDelete) return nothing;
    return html`<div class="actions">${this._renderDeleteButton()}</div>`;
  }

  private _renderApiActionDialog() {
    if (this.sectionKey !== "api") return nothing;
    return html`<esphome-add-api-action-dialog
      .boardName=${this.boardName}
      .configuration=${this.configuration}
      .board=${this.board}
      .yaml=${this.yaml}
      @automation-added=${this._onApiActionAdded}
    ></esphome-add-api-action-dialog>`;
  }

  private _onOpenAddApiAction = () => {
    this._addApiActionDialog?.open();
  };

  /** Backend confirmed the new api_action landed. Route the
   *  navigator (and the right pane) to its editor so the user can
   *  fill in variables + actions immediately. */
  private _onApiActionAdded = (e: CustomEvent<{ sectionKey: string }>) => {
    e.stopPropagation();
    this.dispatchEvent(
      new CustomEvent<{ sectionKey: string }>("section-select", {
        detail: { sectionKey: e.detail.sectionKey },
        bubbles: true,
        composed: true,
      })
    );
  };

  private _onEditApiAction(sectionKey: string) {
    this.dispatchEvent(
      new CustomEvent<{ sectionKey: string }>("section-select", {
        detail: { sectionKey },
        bubbles: true,
        composed: true,
      })
    );
  }

  /**
   * Delete an api_action inline. Uses the same backend path as the
   * api-action-editor's delete (`deleteAutomation` → apply the
   * returned diff → ``updateConfig``). Surfaces failures as a
   * toast; on success the YAML rolls forward via ``yaml-updated``
   * and the table re-renders against the new draft.
   */
  private async _onDeleteApiAction(actionName: string) {
    if (!this._api || !actionName || this._deletingApiAction) return;
    this._deletingApiAction = actionName;
    try {
      const { yaml_diff } = await this._api.deleteAutomation(
        this.configuration,
        { kind: "api_action", action_name: actionName },
        this.yaml
      );
      const newYaml = applyYamlDiff(this.yaml, yaml_diff);
      await this._api.updateConfig(this.configuration, newYaml);
      this.dispatchEvent(
        new CustomEvent<{ yaml: string }>("yaml-updated", {
          detail: { yaml: newYaml },
          bubbles: true,
          composed: true,
        })
      );
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : this._localize("device.automation_save_error");
      toast.error(this._localize("device.automation_save_error"), {
        description: msg,
        richColors: true,
      });
    } finally {
      this._deletingApiAction = "";
    }
  }

  /**
   * Classify the current section for the per-section "+ Add
   * automation" / triggers-list shortcut. Returns ``null`` when the
   * section can't host inline ``on_*:`` automations (api has its own
   * shortcut; script/interval have their own navigator CTAs; data-
   * only blocks like substitutions never carry triggers; component
   * list items without an ``id:`` can't be addressed by the
   * structured editor).
   */
  private _shortcutTarget():
    | null
    | { kind: "device_on" }
    | { kind: "component_on"; componentId: string } {
    if (SHORTCUT_HIDE_KEYS.has(this.sectionKey)) return null;
    if (this.sectionKey === "esphome") return { kind: "device_on" };
    // Otherwise this should be a regular component instance — a list
    // item under a top-level platform block. Look it up by matching
    // section key, biased toward the section's currently-resolved
    // fromLine so multi-instance components route to the right entry.
    const sections = parseYamlTopLevelSections(this.yaml);
    const candidates = sections.filter((s) => sectionKeyOf(s) === this.sectionKey);
    if (candidates.length === 0) return null;
    const match =
      this._resolvedFromLine !== undefined
        ? (candidates.find((s) => s.fromLine === this._resolvedFromLine) ?? candidates[0])
        : candidates[0];
    if (!match.id) return null;
    return { kind: "component_on", componentId: match.id };
  }

  /**
   * Inline manage-list of inline trigger automations for the current
   * section. Parallels ``_renderApiActionsTable`` — same row UI,
   * same edit/delete affordances — but scoped to ``component_on``
   * triggers on a component instance (filtered by ``id``) or
   * ``device_on`` triggers under the ``esphome:`` block.
   */
  private _renderTriggersTable() {
    const target = this._shortcutTarget();
    if (target === null) return nothing;
    const items = parseYamlAutomations(this.yaml).filter((s) => {
      if (!s.eventKey) return false;
      if (target.kind === "device_on") return s.parentKey === "esphome";
      return s.id === target.componentId;
    });
    const locked = this._deletingTrigger !== "";
    const title =
      target.kind === "device_on"
        ? this._localize("device.automations_list_title_device")
        : this._localize("device.automations_list_title");
    return html`<div class="api-actions-table">
      <div class="api-actions-header">
        <h4 class="api-actions-title">${title}</h4>
        <button type="button" class="api-actions-add" @click=${this._onOpenAddAutomation}>
          <wa-icon library="mdi" name="plus"></wa-icon>
          ${this._localize("device.add_automation")}
        </button>
      </div>
      ${items.length === 0
        ? html`<p class="api-actions-empty" role="status">
            ${this._localize("device.automations_list_empty")}
          </p>`
        : html`<ul class="api-actions-rows">
            ${items.map(
              (item) =>
                html`<li class="api-actions-row">
                  <span class="api-actions-name">${item.eventKey}</span>
                  <div class="api-actions-row-buttons">
                    <button
                      type="button"
                      class="api-actions-row-edit"
                      aria-label=${this._localize("device.automations_list_edit")}
                      title=${this._localize("device.automations_list_edit")}
                      ?disabled=${locked}
                      @click=${() => this._onEditTrigger(item.key)}
                    >
                      <wa-icon library="mdi" name="pencil"></wa-icon>
                    </button>
                    <button
                      type="button"
                      class="api-actions-row-delete"
                      aria-label=${this._localize("device.automations_list_delete")}
                      title=${this._localize("device.automations_list_delete")}
                      ?disabled=${locked}
                      @click=${() =>
                        this._onDeleteTrigger(target, item.eventKey ?? "", item.key)}
                    >
                      <wa-icon library="mdi" name="delete"></wa-icon>
                    </button>
                  </div>
                </li>`
            )}
          </ul>`}
    </div>`;
  }

  private _renderAddAutomationDialog() {
    if (this._shortcutTarget() === null) {
      return nothing;
    }
    return html`<esphome-add-automation-dialog
      .boardName=${this.boardName}
      .configuration=${this.configuration}
      .board=${this.board}
      .yaml=${this.yaml}
      @automation-added=${this._onAutomationAdded}
    ></esphome-add-automation-dialog>`;
  }

  private _onOpenAddAutomation = () => {
    const target = this._shortcutTarget();
    if (target === null) return;
    if (target.kind === "device_on") {
      this._addAutomationDialog?.open({ kind: "device_on" });
    } else {
      this._addAutomationDialog?.open({
        kind: "component_on",
        componentId: target.componentId,
      });
    }
  };

  private _onAutomationAdded = (e: CustomEvent<{ sectionKey: string }>) => {
    e.stopPropagation();
    this.dispatchEvent(
      new CustomEvent<{ sectionKey: string }>("section-select", {
        detail: { sectionKey: e.detail.sectionKey },
        bubbles: true,
        composed: true,
      })
    );
  };

  private _onEditTrigger(sectionKey: string) {
    this.dispatchEvent(
      new CustomEvent<{ sectionKey: string }>("section-select", {
        detail: { sectionKey },
        bubbles: true,
        composed: true,
      })
    );
  }

  /**
   * Delete a ``component_on`` / ``device_on`` trigger inline. Same
   * backend path as the automation editor's delete: ``deleteAutomation``
   * → apply the returned diff → ``updateConfig``. Toasts on failure;
   * on success the YAML rolls forward via ``yaml-updated`` and the
   * table re-renders against the new draft.
   */
  private async _onDeleteTrigger(
    target: { kind: "device_on" } | { kind: "component_on"; componentId: string },
    trigger: string,
    rowKey: string
  ) {
    if (!this._api || !trigger || this._deletingTrigger) return;
    this._deletingTrigger = rowKey;
    try {
      const location: AutomationLocation =
        target.kind === "device_on"
          ? { kind: "device_on", trigger }
          : {
              kind: "component_on",
              component_id: target.componentId,
              trigger,
            };
      const { yaml_diff } = await this._api.deleteAutomation(
        this.configuration,
        location,
        this.yaml
      );
      const newYaml = applyYamlDiff(this.yaml, yaml_diff);
      await this._api.updateConfig(this.configuration, newYaml);
      this.dispatchEvent(
        new CustomEvent<{ yaml: string }>("yaml-updated", {
          detail: { yaml: newYaml },
          bubbles: true,
          composed: true,
        })
      );
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : this._localize("device.automation_save_error");
      toast.error(this._localize("device.automation_save_error"), {
        description: msg,
        richColors: true,
      });
    } finally {
      this._deletingTrigger = "";
    }
  }
}

/**
 * Sections that don't host inline ``on_*:`` automations. The
 * shortcut is hidden on these. ``api`` has its own ``+ Add API
 * action`` flow (PR #360); ``script`` / ``interval`` get their
 * dedicated navigator CTAs; the rest are data-only blocks where a
 * trigger handler doesn't make sense.
 */
const SHORTCUT_HIDE_KEYS = new Set([
  "api",
  "script",
  "interval",
  "external_components",
  "packages",
  "substitutions",
  "globals",
  "dashboard_import",
]);

declare global {
  interface HTMLElementTagNameMap {
    "esphome-device-section-config": ESPHomeDeviceSectionConfig;
  }
}
