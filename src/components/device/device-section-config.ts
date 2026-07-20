import { consume } from "@lit/context";
import {
  mdiAlertCircleOutline,
  mdiDelete,
  mdiInformationOutline,
  mdiOpenInNew,
  mdiPencil,
  mdiPlusCircleOutline,
} from "@mdi/js";
import { html, LitElement, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import memoizeOne from "memoize-one";
import type { ESPHomeAPI } from "../../api/index.js";
import type { BoardCatalogEntry } from "../../api/types/boards.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { apiContext, localizeContext } from "../../context/index.js";
import { dangerBannerStyles } from "../../styles/banners.js";
import { inputStyles } from "../../styles/inputs.js";
import { espHomeStyles } from "../../styles/shared.js";
import {
  NO_INSTANCE_ERRORS,
  type InstanceBackendErrors,
} from "../../util/backend-field-errors.js";
import type { ValidationError } from "../../util/config-validation.js";
import { fireEvent } from "../../util/fire-event.js";
import { formatApiError } from "../../util/format-api-error.js";
import { notifyError } from "../../util/notify.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { resolveSectionEntries } from "../../util/section-entry-overrides.js";
import {
  applyYamlDiff,
  locationFromSectionKey,
  sectionKeyFromLocation,
} from "./automation-editor/serialise.js";
import { TriggerCatalogController } from "./trigger-catalog-controller.js";
import { isYamlOnlySection } from "./yaml-only-sections.js";

import { fieldHighlightStyles } from "./field-highlight.styles.js";

import "@home-assistant/webawesome/dist/components/spinner/spinner.js";
import type { ESPHomeConfirmDialog } from "../confirm-dialog.js";
import type { ESPHomeAddApiActionDialog } from "./add-api-action-dialog.js";
import type { ESPHomeAddAutomationDialog } from "./add-automation-dialog.js";
import type { ConfigEntryValueChange } from "./config-entry-form.js";
import { deviceSectionConfigStyles } from "./device-section-config.styles.js";
import {
  applySectionValues,
  flushDraft,
  onDeleteConfirmed,
  onValueChange,
} from "./device-section-config/draft-and-delete.js";
import {
  loadConfig,
  type SectionConfigResponse,
} from "./device-section-config/loading.js";
import {
  maybeFlashApiActionsList,
  revealAdvancedForErrors,
  revealAdvancedForFocus,
} from "./device-section-config/reveal.js";
import {
  renderPlatformDomainBranch,
  renderStructuredFormBranch,
  renderYamlOnlyBranch,
} from "./device-section-config/render-branches.js";
import {
  renderAddAutomationDialog,
  renderApiActionDialog,
  renderDeleteConfirmDialog,
} from "./device-section-config/render-dialogs.js";
import { renderSectionHeader } from "./device-section-config/render-header.js";
import {
  resolveComponentId,
  resolveShortcutTarget,
  type ShortcutTarget,
} from "./device-section-config/shortcut-target.js";
import type { ApplySectionValuesDetail } from "./notice-banner.js";

registerMdiIcons({
  "alert-circle-outline": mdiAlertCircleOutline,
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

  // Instance-relative field path to scroll into view, from the YAML cursor.
  @property({ attribute: false }) focusFieldPath?: string[];

  // This section instance's backend errors, refreshed per lint pass.
  // Field errors merge under the client-side _fieldErrors; the message
  // lists feed the section alert so a navigator badge always leads to a
  // readable message.
  @property({ attribute: false }) backendErrors: InstanceBackendErrors =
    NO_INSTANCE_ERRORS;

  // Same string the YAML pane shows including unsaved edits. Save and delete
  // operate on this rather than re-fetching: the navigator emits fromLine
  // relative to live YAML, so an out-of-sync version would point the splice
  // at the wrong line. Empty values caught by resolveCurrentFromLine.
  @property() yaml = "";

  // Whether the device editor's YAML pane is currently visible — when not,
  // the YAML-only notice surfaces a "Show YAML editor" CTA. Property-only:
  // a default-true boolean can't receive false through an attribute
  // binding on first render (absence is indistinguishable from unset).
  @property({ attribute: false }) yamlPaneVisible = true;

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

  /** Stable section key of the manage-list row whose inline delete is
   *  in flight (api action, trigger, or component action field). One
   *  delete at a time across every list — the table locks all rows
   *  while it's non-empty so a second delete can't race the first. */
  @state() _deletingRow = "";

  // Custom / external component the backend catalog doesn't describe —
  // synthetic empty-entries _config triggers the YAML-only notice; subtitle
  // shows the domain.platform so the user can see which key it applies to.
  @state() _isUnknown = false;

  // A bare platform-domain section (`switch:` with no items yet) — the
  // catalog only carries dotted ids, so it misses like an unknown key but
  // gets an add-a-platform affordance instead of the external treatment.
  @state() _isPlatformDomain = false;

  @state() _fieldErrors: Map<string, ValidationError> = new Map();

  // Backend-error paths the user has edited since the last lint pass —
  // suppressed until the next backendErrors refresh re-evaluates them, so
  // a fixed value doesn't keep its stale error for the lint round-trip.
  @state() _clearedBackendPaths: Set<string> = new Set();

  // Per-section so switching components doesn't bleed state.
  @state() _advancedShownSections = new Set<string>();
  @state() _presentComponents: Set<string> = new Set();

  // Sections whose advanced fields we've auto-revealed for caret-follow once.
  // Not reactive — bookkeeping so a later deliberate collapse isn't reopened.
  readonly _autoRevealedSections = new Set<string>();

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
  /** ``focusFieldPath`` key already flashed — one-shot per target. */
  _apiListFlashKey?: string;
  // Parent loops yaml-draft events back through our yaml prop, which would
  // trigger reload() and lose focus mid-edit. reload() short-circuits when
  // the live yaml matches this snapshot.
  _lastSelfWrittenYaml: string | null = null;

  // Resolves the automations-list rows' pretty trigger names; shared
  // with the device navigator.
  readonly _triggerCatalog = new TriggerCatalogController(this, () => ({
    api: this._api,
    platform: this.board?.esphome.platform || undefined,
    boardId: this.board?.id,
  }));

  // 200ms is short enough that the YAML pane feels live as the user moves
  // between fields, long enough to coalesce typing into one splice.
  private static readonly DRAFT_DEBOUNCE_MS = 200;

  /** Backend errors under client-side ones — the client map is live per
   *  keystroke while the backend map lags a lint round-trip, so on a path
   *  collision the client's message wins. Memoised so per-keystroke renders
   *  keep the form's errors prop identity stable. */
  _mergeErrors = memoizeOne(
    (
      backend: Map<string, ValidationError>,
      cleared: Set<string>,
      field: Map<string, ValidationError>
    ): Map<string, ValidationError> => {
      if (backend.size === 0) return field;
      const merged = new Map<string, ValidationError>();
      for (const [path, err] of backend) {
        if (!cleared.has(path)) merged.set(path, err);
      }
      if (merged.size === 0) return field;
      for (const [path, err] of field) merged.set(path, err);
      return merged;
    }
  );

  get _showAdvanced(): boolean {
    return this._advancedShownSections.has(this.sectionKey);
  }

  _setShowAdvanced(show: boolean) {
    const next = new Set(this._advancedShownSections);
    if (show) next.add(this.sectionKey);
    else next.delete(this.sectionKey);
    this._advancedShownSections = next;
  }

  _onAdvancedToggle = (e: CustomEvent<{ show: boolean }>) => {
    this._setShowAdvanced(e.detail.show);
  };

  static styles = [
    espHomeStyles,
    inputStyles,
    dangerBannerStyles,
    deviceSectionConfigStyles,
    fieldHighlightStyles,
  ];

  willUpdate(changedProperties: Map<string, unknown>) {
    // A fresh lint pass re-evaluated every path; drop the local
    // suppressions so still-broken fields regain their error.
    if (changedProperties.has("backendErrors") && this._clearedBackendPaths.size) {
      this._clearedBackendPaths = new Set();
    }
    // loadConfig synchronously flips _loading/_config/_error; running it in
    // willUpdate folds those into the in-progress render rather than
    // scheduling a second one.
    if (
      (changedProperties.has("sectionKey") ||
        changedProperties.has("configuration") ||
        changedProperties.has("fromLine")) &&
      this.sectionKey &&
      this.configuration
    ) {
      void loadConfig(this);
    }
    this._revealAdvancedForFocus(changedProperties);
    this._revealAdvancedForErrors(changedProperties);
  }

  private _revealAdvancedForErrors(changedProperties: Map<string, unknown>): void {
    revealAdvancedForErrors(this, changedProperties);
  }

  private _revealAdvancedForFocus(changedProperties: Map<string, unknown>): void {
    revealAdvancedForFocus(this, changedProperties);
  }

  updated() {
    this._triggerCatalog.ensure();
    maybeFlashApiActionsList(this);
  }

  connectedCallback() {
    super.connectedCallback();
    // Announce so the page-level navigation guard (device.ts) can hold a
    // direct ref. The tree is page → device-editor → device-board-info → us;
    // a property passthrough chain would cost three edits per API change.
    fireEvent(this, "section-mount", { node: this });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._draftTimer) {
      clearTimeout(this._draftTimer);
      this._draftTimer = null;
    }
    fireEvent(this, "section-unmount", { node: this });
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
    fireEvent(this, "dirty-change", { dirty: value });
  }

  _scheduleDraftFlush() {
    if (this._draftTimer) clearTimeout(this._draftTimer);
    this._draftTimer = setTimeout(
      () => flushDraft(this),
      ESPHomeDeviceSectionConfig.DRAFT_DEBOUNCE_MS
    );
  }

  _onShowYamlEditor() {
    fireEvent(this, "show-yaml-editor");
  }

  _onAddPlatform() {
    // Same deep-link the id-reference "+ Add new <domain>" pickers use:
    // board-info catches it and opens the add-component dialog filtered
    // to this domain.
    fireEvent(this, "request-add-component", { domain: this.sectionKey });
  }

  _onValueChange = (e: CustomEvent<ConfigEntryValueChange>) => onValueChange(this, e);

  _onDeleteConfirmed = () => onDeleteConfirmed(this);

  _onApplySectionValues = (e: CustomEvent<ApplySectionValuesDetail>) =>
    applySectionValues(this, e.detail.changes);

  protected render() {
    if (this._loading) {
      return html`<div class="loading"><wa-spinner></wa-spinner></div>`;
    }

    if (this._error && !this._config) {
      return html`<p class="error">${this._error}</p>`;
    }

    if (!this._config) return nothing;
    const config = this._config;

    // Handles overrides for sections whose backend schema doesn't match the
    // actual user-keyed shape (currently just substitutions).
    const renderEntries = resolveSectionEntries(this.sectionKey, config.entries);
    // Free-form / structural sections: show "edit via YAML" instead of the
    // form. external_components and packages are always-YAML (discriminated
    // unions don't fit the catalog — see #361 for the packages data-loss
    // regression). Zero-entries sections also fall back here.
    const yamlOnly = isYamlOnlySection(this.sectionKey, renderEntries.length);

    // Backend messages this pane must carry: section-level ones when the
    // banner's pane is hidden, and field-mapped ones for yaml-only
    // sections in every layout — with no form to render them inline,
    // their only other surface is the squiggle hover.
    const sectionAlerts = [
      ...(this.yamlPaneVisible ? [] : this.backendErrors.sectionMessages),
      ...(yamlOnly ? this.backendErrors.fieldMessages : []),
    ];

    const canDelete = !UNDELETABLE_SECTIONS.has(this.sectionKey);

    return html`
      ${renderSectionHeader(this, config, sectionAlerts)}
      ${
        this._isPlatformDomain
          ? renderPlatformDomainBranch(this, canDelete)
          : yamlOnly
            ? renderYamlOnlyBranch(this, canDelete)
            : renderStructuredFormBranch(this, config, canDelete)
      }
      ${renderApiActionDialog(this)} ${renderAddAutomationDialog(this)}
      ${renderDeleteConfirmDialog(this, canDelete, config)}
    `;
  }

  _onOpenAddApiAction = () => {
    this._addApiActionDialog?.open();
  };

  /** Backend confirmed the new api_action landed. Route the
   *  navigator (and the right pane) to its editor so the user can
   *  fill in variables + actions immediately. */
  _onApiActionAdded = (e: CustomEvent<{ sectionKey: string }>) => {
    e.stopPropagation();
    fireEvent(this, "section-select", { sectionKey: e.detail.sectionKey });
  };

  /** Edit any manage-list row: route the navigator to its stable
   *  section key. Shared by api actions, triggers, and action fields —
   *  every row carries its ``automation:…`` key. */
  _onEditRow = (e: CustomEvent<{ key: string }>) => {
    e.stopPropagation();
    fireEvent(this, "section-select", { sectionKey: e.detail.key });
  };

  /**
   * Delete any manage-list row inline. The row key IS a stable
   * ``automation:…`` section key, so ``locationFromSectionKey`` decodes
   * the right ``AutomationLocation`` for api actions, triggers, and
   * component action fields alike — one backend path
   * (``deleteAutomation`` → apply diff → ``updateConfig``) for all three.
   * One delete at a time; ``_deletingRow`` locks the lists meanwhile.
   */
  _onDeleteRow = async (e: CustomEvent<{ key: string }>) => {
    e.stopPropagation();
    const key = e.detail.key;
    const location = locationFromSectionKey(key);
    if (!this._api || !location || this._deletingRow) return;
    this._deletingRow = key;
    try {
      const { yaml_diff } = await this._api.deleteAutomation(
        this.configuration,
        location,
        this.yaml
      );
      const newYaml = applyYamlDiff(this.yaml, yaml_diff);
      await this._api.updateConfig(this.configuration, newYaml);
      fireEvent(this, "yaml-updated", { yaml: newYaml });
    } catch (err) {
      const msg = formatApiError(err, this._localize, "device.automation_save_error");
      notifyError(this._localize("device.automation_save_error"), {
        description: msg,
      });
    } finally {
      this._deletingRow = "";
    }
  };

  /**
   * Target for the per-section "+ Add automation" / triggers-list
   * shortcut. Thin wrapper over the pure ``resolveShortcutTarget``,
   * injecting this section's catalog gate.
   */
  _shortcutTarget(): ShortcutTarget {
    return resolveShortcutTarget(
      this.yaml,
      this.sectionKey,
      this._resolvedFromLine,
      (scopes) => this._triggerCatalog.hasTriggersFor(scopes)
    );
  }

  /** Addressable id of the component instance this section edits, or null. */
  _resolveComponentId(): string | null {
    return resolveComponentId(this.yaml, this.sectionKey, this._resolvedFromLine);
  }

  _onOpenAddAutomation = () => {
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

  _onAutomationAdded = (e: CustomEvent<{ sectionKey: string }>) => {
    e.stopPropagation();
    fireEvent(this, "section-select", { sectionKey: e.detail.sectionKey });
  };

  /**
   * Route an in-form "Edit actions" click (from a ``TRIGGER`` config
   * field like cover ``open_action``) to the automation editor. The
   * form knows only the field key; resolve this instance's component id
   * and build the ``component_action`` section key here.
   */
  _onEditActionField = (e: CustomEvent<{ field: string }>) => {
    e.stopPropagation();
    const componentId = this._resolveComponentId();
    if (componentId === null) return;
    const sectionKey = sectionKeyFromLocation({
      kind: "component_action",
      component_id: componentId,
      field: e.detail.field,
    });
    fireEvent(this, "section-select", { sectionKey });
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-device-section-config": ESPHomeDeviceSectionConfig;
  }
}
