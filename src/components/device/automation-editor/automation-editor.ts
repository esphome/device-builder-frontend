/**
 * Top-level automation editor.
 *
 * Public surface (per the design plan):
 *
 * - ``configuration`` — the device's YAML filename, used as the
 *   first argument to every ``automations/*`` WS command.
 * - ``platform`` / ``board`` — forwarded to the catalog fetches and
 *   into ``<esphome-config-entry-form>`` for pin / id pickers.
 * - ``value`` — the current ``AutomationTree`` (``null`` in add
 *   mode).
 * - ``location`` — the ``AutomationLocation`` the editor saves to.
 *
 * Events:
 *
 * - ``automation-change`` (``detail: { value, location }``) — fires
 *   on every internal mutation so the parent (the page or the
 *   add-dialog) can mirror state.
 * - ``automation-save`` — fires when the upsert succeeds; detail
 *   carries the returned ``YamlDiff`` so the parent applies the
 *   splice to its in-memory YAML.
 * - ``automation-delete`` — fires when the delete succeeds.
 *
 * Save/delete are optimistic + revert-on-failure per CLAUDE.md.
 * The in-flight write guard mirrors ``_remoteBuildSetInFlight`` so
 * the post-reconnect re-parse path can short-circuit while a write
 * is outstanding.
 */
import { consume } from "@lit/context";
import { html, LitElement, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import memoizeOne from "memoize-one";

import type { ESPHomeAPI } from "../../../api/index.js";
import type {
  AutomationLocation,
  AutomationTree,
  AvailableAutomations,
  AvailableComponentInstance,
  AvailableScript,
} from "../../../api/types/automations.js";
import type { BoardCatalogEntry } from "../../../api/types/boards.js";
import type { ComponentCatalogEntry } from "../../../api/types/components.js";
import type { LocalizeFunc } from "../../../common/localize.js";
import { apiContext, localizeContext } from "../../../context/index.js";
import { inputStyles } from "../../../styles/inputs.js";
import { espHomeStyles } from "../../../styles/shared.js";
import { formatApiError } from "../../../util/format-api-error.js";
import { parseSubstitutions } from "../../../util/substitutions.js";
import { AutoApplyController } from "./auto-apply-controller.js";
import type { ESPHomeAutomationActionList } from "./automation-action-list.js";
import { automationEditorStyles } from "./automation-editor.styles.js";
import {
  type AutomationFocus,
  automationRelativePath,
  resolveAutomationFocus,
  type YamlPathSegment,
} from "./automation-focus.js";
import { CatalogLoadController } from "./catalog-load-controller.js";
import { loadIntervalComponent } from "./load-interval-component.js";
import { ParseErrorController } from "./parse-error-controller.js";
import { renderAutomationHeader } from "./render-automation-header.js";
import {
  renderActionsSection,
  renderAddModePickers,
  renderDeleteRow,
  renderIdentityFields,
  renderTriggerParamsForm,
} from "./render-automation-sections.js";
import {
  applyParamChange,
  emptyAutomationTree,
  sectionKeyFromLocation,
} from "./serialise.js";
import { bareTriggerKey, effectiveTriggerIdFor } from "./trigger-identity.js";

import "@home-assistant/webawesome/dist/components/spinner/spinner.js";

@customElement("esphome-automation-editor")
export class ESPHomeAutomationEditor extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: apiContext })
  private _api!: ESPHomeAPI;

  @property() configuration = "";

  @property({ attribute: false })
  board: BoardCatalogEntry | null = null;

  @property() platform = "";

  @property({ attribute: false })
  value: AutomationTree | null = null;

  @property({ attribute: false })
  location: AutomationLocation | null = null;

  /**
   * True when the editor is mounted from the "+ Add automation" /
   * "+ Add script" entry point. Add-mode lets the user pick / edit
   * the target (kind + component / script id); edit-mode locks the
   * target picker (changing it would move the YAML splice to a
   * different range, which we don't support inline).
   *
   * The add-dialog passes a seed ``location`` (so the editor knows
   * which target kind to render) AND sets ``addMode``, which is
   * what we'd otherwise have to infer racily.
   */
  @property({ type: Boolean, attribute: "add-mode" })
  addMode = false;

  @property() yaml = "";

  /** Document-absolute indexed key path at the YAML cursor; resolved
   *  against the hydrated tree to scroll/highlight the matching node
   *  or field. Ignored when it doesn't land inside this automation. */
  @property({ attribute: false })
  focusYamlPath?: YamlPathSegment[];

  /** Action-list reference — used by the header-positioned Add
   *  button to open the catalog picker dialog that lives inside
   *  the action-list component. */
  @query("esphome-automation-action-list")
  private _actionList?: ESPHomeAutomationActionList;

  /** Scoped catalog response. Trigger / action / condition lists
   *  come from here (the backend filters to what's actually in the
   *  device's YAML) so the dropdowns only show what's usable. */
  @state() private _available: AvailableAutomations | null = null;

  /** Component catalog entry for the ``interval`` component, lazily
   *  fetched the first time we render an interval automation. Drives
   *  the header (name / description / docs / image) and the inline
   *  config-entry form (the ``interval:`` time field that used to
   *  live in a dead "Target #N" readonly box). */
  @state() private _intervalComponent: ComponentCatalogEntry | null = null;

  @state() private _loading = true;
  @state() private _error = "";
  /** Renders read-only + blocks auto-apply for a parse-errored
   *  automation so its empty tree can't overwrite the real YAML. */
  private readonly _parseError = new ParseErrorController(this);

  /** Owns the catalog-load concurrency guard (sequence token +
   *  host-disconnect invalidation) so an overlapping load can't
   *  clobber ``_available``, paint a stale slim catalog, or
   *  double-fire the partial-hydration toast. Shared with the
   *  trigger-less editors (script, api-action). */
  private readonly _catalogLoad = new CatalogLoadController(this);

  /** "Show advanced settings" toggle state for the params form.
   *  Mirrors ``device-section-config``'s same-named state but
   *  scoped to this editor instance — switching away and back
   *  resets to collapsed, matching the component-editor UX. */
  @state() private _showAdvanced = false;

  /** Shared auto-apply / delete / dirty-tracking engine — same
   *  instance shape as the script and api-action editors so the
   *  page-level save guard can treat all three uniformly. */
  private readonly _engine = new AutoApplyController(this, {
    getApi: () => this._api,
    getLocalize: () => this._localize,
    isReadOnly: () => this._parseError.active,
    setError: (message) => {
      this._error = message;
    },
  });

  public get dirty(): boolean {
    return this._engine.dirty;
  }

  /**
   * Derived: edit-mode = not add-mode. Snapshot taken in
   * ``connectedCallback`` so hydrate doesn't flip it back.
   */
  @state() private _editMode = false;

  /** In-flight write guard — parents that re-fetch on reconnect
   *  should consult this to skip clobbering an optimistic update. */
  public get inFlightWrite(): boolean {
    return this._engine.inFlightWrite;
  }

  /** Parse ``substitutions:`` from the current YAML once per edit so the
   *  read-only Target field can preview ${...} like the text fields do. */
  private _parseSubstitutions = memoizeOne(parseSubstitutions);

  /** Cursor path → tree focus. Memoized on (value, location, path) so it
   *  self-heals once the async hydrate lands the tree. */
  private _resolveFocus = memoizeOne(
    (
      value: AutomationTree | null,
      location: AutomationLocation | null,
      path?: YamlPathSegment[]
    ): AutomationFocus | null => {
      if (!value || !path?.length) return null;
      const rel = automationRelativePath(path, location);
      return rel ? resolveAutomationFocus(value, rel) : null;
    }
  );

  static styles = [espHomeStyles, inputStyles, automationEditorStyles];

  connectedCallback(): void {
    super.connectedCallback();
    // Snapshot the add-vs-edit context once at mount so subsequent
    // property changes (the hydrate-from-backend cycle fills value
    // and re-pins location) don't accidentally unlock the picker
    // after it should stay locked.
    this._editMode = !this.addMode;
    // ``_loadAvailable`` fires from ``updated()`` on the first
    // render once ``configuration`` lands — no separate kickoff
    // here, otherwise we'd send two ``automations/get_available``
    // calls per mount. The section-mount announcement (which lets
    // the page-level save guard hold a direct ref and call
    // flushPending() before its global save) is dispatched by the
    // shared engine's hostConnected.
  }

  protected updated(changed: Map<string, unknown>) {
    if (changed.has("configuration")) {
      void this._loadAvailable();
    }
    // Navigator-driven location swap: when the parent passes in a
    // different ``location`` (user clicked a sibling automation),
    // the editor element is reused — its previous ``value`` is
    // stale. Invalidate it so the hydrate path below re-fetches
    // the matching ParsedAutomation. Without this guard the
    // trigger / actions panels keep showing the old automation's
    // content while the location-derived metadata fields update.
    if (changed.has("location") && !this.addMode) {
      const prev = changed.get("location") as AutomationLocation | null | undefined;
      if (
        prev &&
        this.location &&
        sectionKeyFromLocation(prev) !== sectionKeyFromLocation(this.location)
      ) {
        this.value = null;
      }
    }
    // Hydrate from the backend in edit-mode: when the editor was
    // mounted with a known location but no value, we look up the
    // matching ParsedAutomation and populate value/location from
    // it. Triggering on ``_loading`` covers the common case where
    // the editor was mounted with the location already set — the
    // first ``location`` change fires while ``_loading=true``, so
    // we re-check after catalogs finish loading rather than waiting
    // for another location mutation that may never come.
    if (
      !this.addMode &&
      (changed.has("location") ||
        changed.has("configuration") ||
        changed.has("_loading")) &&
      this.location &&
      this.value === null &&
      !this._loading
    ) {
      void this._hydrateFromBackend();
    }
    // Interval automations need the ``interval`` component schema
    // so the header can show its description + docs link + image
    // and the form can render its config_entries (the actual
    // ``interval: 5s`` time field). Fetch lazily — only when we
    // actually land on an interval.
    if (
      (changed.has("location") || changed.has("platform")) &&
      this.location?.kind === "interval"
    ) {
      void this._loadIntervalComponent();
    }
  }

  /** Lazy fetch of the ``interval`` component catalog entry —
   *  cache-first + error-swallowing, see the helper module. */
  private async _loadIntervalComponent() {
    if (!this._api) return;
    const entry = await loadIntervalComponent(
      this._api,
      this.platform || undefined,
      this.board?.id
    );
    if (entry) this._intervalComponent = entry;
  }

  /**
   * When the editor is mounted in edit mode (a navigator click
   * landed us here with a ``location`` but no ``value``), pull the
   * parsed automation list and match by stable section key. This
   * keeps the editor self-contained — the parent only needs to
   * pass the section key's location.
   */
  private async _hydrateFromBackend() {
    if (!this._api || !this.configuration || !this.location) return;
    try {
      // Pass ``this.yaml`` so the parser sees the user's current
      // draft buffer — without it the post-add hydrate would read
      // the on-disk YAML, miss the just-inserted automation, and
      // leave the form empty even though the YAML pane shows the
      // user's input.
      const parsed = await this._api.parseDeviceAutomations(
        this.configuration,
        this.yaml
      );
      // A successful parse clears any prior parse error, so the banner
      // doesn't stick after the user fixes invalid YAML in the pane.
      this._error = "";
      // Re-pin location to the parser's canonical form (script id
      // matched, light_effect index resolved against the actual YAML);
      // the controller withholds a read-only automation's empty tree.
      const m = this._parseError.resolve(parsed, this.location);
      if (m) {
        this.location = m.location;
        this.value = m.tree;
      }
    } catch (err) {
      this._error = formatApiError(err, this._localize, "device.automation_parse_error");
    }
  }

  /**
   * Re-hydrate from the live YAML. Called by the parent
   * (``device-board-info``) when the YAML pane changes the document
   * out from under us — mirrors the device-section-config reload
   * pattern so editing YAML in the pane updates the visual editor.
   *
   * Skip cases:
   *  - Our own write echoing back via the prop (avoid clobbering the
   *    user's just-applied edit).
   *  - An auto-apply currently in flight (we're already writing /
   *    about to overwrite; let it finish).
   *  - Add mode (no location to hydrate from yet).
   */
  public reload(): void {
    if (this.addMode || !this.location) return;
    if (this._engine.shouldSkipReload()) return;
    void this._hydrateFromBackend();
  }

  private async _loadAvailable() {
    if (!this._api || !this.configuration) return;
    this._loading = true;
    this._error = "";
    const { available, error } = await this._catalogLoad.load(
      this._api,
      this.configuration,
      this._localize,
      {
        // All three lists: this editor renders the trigger picker.
        lists: ["triggers", "actions", "conditions"],
        // Scope off the draft so a just-added component's triggers
        // surface while re-editing before the global save (#1348).
        yaml: this.yaml,
        // Paint the slim list and drop the spinner so the dropdowns
        // mount while hydration runs; the controller guards this
        // against a superseded load. The post-hydration ``available``
        // below carries fresh array refs so identity-based
        // ``hasChanged`` consumers re-render with the hydrated bodies.
        onPaint: (painted) => {
          this._available = painted;
          this._loading = false;
        },
      }
    );
    // A stale/no-op load returns neither field — leave ``_loading`` to
    // the newer load that superseded this one (the old finally-seq
    // guard). The partial-hydration toast fires inside the controller.
    if (error !== undefined) {
      this._error = error;
      this._loading = false;
    }
    if (available) {
      this._available = available;
      this._loading = false;
    }
  }

  protected render() {
    if (this._loading) {
      return html`<div class="ae-empty">
        <wa-spinner></wa-spinner>
        ${this._localize("device.loading_automation_catalog")}
      </div>`;
    }
    if (this._parseError.active) {
      return this._parseError.renderPanel(this._localize);
    }
    const automation = this.value ?? emptyAutomationTree();
    const target = this.location;
    const devices = this._available?.devices ?? [];
    const scripts = this._available?.scripts ?? [];
    // Catalog dropdowns read from the scoped lists so they only
    // surface what this device's YAML can actually use (per the
    // backend's filtering — see ``catalog.triggers_for_domains``
    // etc.). When ``_available`` hasn't loaded yet the dropdowns
    // are empty rather than showing the unfiltered universe.
    const triggers = this._available?.triggers ?? [];
    const actions = this._available?.actions ?? [];
    const conditions = this._available?.conditions ?? [];
    const disabled = this._engine.deleting;
    const effectiveTriggerId = effectiveTriggerIdFor(automation, target, devices);
    const activeTrigger = effectiveTriggerId
      ? (triggers.find((t) => t.id === effectiveTriggerId) ?? null)
      : null;
    const focus = this._resolveFocus(this.value, this.location, this.focusYamlPath);
    return html`
      ${renderAutomationHeader(
        this.location,
        this._intervalComponent,
        activeTrigger,
        this._localize
      )}
      ${
        this.addMode
          ? renderAddModePickers({
              target,
              triggers,
              devices,
              scripts,
              effectiveTriggerId,
              automation,
              board: this.board,
              yaml: this.yaml,
              disabled,
              onTargetChange: this._onTargetChange,
              onTriggerChange: this._onTriggerChange,
              onTriggerParamsChange: this._onTriggerParamsChange,
            })
          : html`${renderIdentityFields(
              this.location,
              devices,
              this._parseSubstitutions(this.yaml),
              this._localize
            )}${renderTriggerParamsForm({
              location: this.location,
              intervalComponent: this._intervalComponent,
              activeTrigger,
              automation,
              board: this.board,
              yaml: this.yaml,
              disabled,
              showAdvanced: this._showAdvanced,
              focusFieldPath: focus && focus.node.length === 0 ? focus.field : undefined,
              onValueChange: this._onTriggerParamsValueChange,
              onAdvancedToggle: this._onAdvancedToggle,
            })}`
      }
      ${renderActionsSection({
        automation,
        catalog: actions,
        conditionCatalog: conditions,
        scripts,
        devices,
        board: this.board,
        yaml: this.yaml,
        disabled,
        localize: this._localize,
        focusTarget: focus && focus.node.length > 0 ? focus : null,
        onOpenPicker: () => this._actionList?.openPicker(),
        onActionsChange: this._onActionsChange,
      })}
      ${this._error ? html`<p class="ae-error" role="alert">${this._error}</p>` : nothing}
      ${
        this.location && this.value && !this.addMode
          ? renderDeleteRow(this._localize, disabled, this._onDelete)
          : nothing
      }
    `;
  }

  private _onAdvancedToggle = (e: CustomEvent<{ show: boolean }>) => {
    this._showAdvanced = e.detail.show;
  };

  private _onTriggerParamsValueChange = (
    e: CustomEvent<{ path: string[]; value: unknown }>
  ) => {
    e.stopPropagation();
    // Form's value-change events carry path-based updates; merge
    // into the trigger_params dict.
    const { path, value } = e.detail;
    const automation = this.value ?? emptyAutomationTree();
    const next = applyParamChange(automation.trigger_params, path, value);
    this._engine.withValue({ trigger_params: next });
  };

  // ─── State mutations ─────────────────────────────────────────

  /**
   * Force a pending debounced auto-apply to flush immediately.
   * The device page calls this on the active section before its
   * global save so the YAML buffer is fully caught up with the
   * editor state.
   */
  public flushPending(): Promise<void> {
    return this._engine.flushPending();
  }

  private _onTargetChange = (e: CustomEvent<{ target: AutomationLocation | null }>) => {
    e.stopPropagation();
    this.location = e.detail.target;
    // Reset trigger when switching target kinds — the previous
    // trigger id wouldn't apply to the new target's domain.
    this._engine.withValue({ trigger_id: null, trigger_params: {} });
  };

  private _onTriggerChange = (
    e: CustomEvent<{ triggerId: string; params: Record<string, unknown> }>
  ) => {
    e.stopPropagation();
    this._engine.withValue({
      trigger_id: e.detail.triggerId,
      trigger_params: e.detail.params,
    });
    // For device-level and component-level automations the trigger
    // name is part of the YAML splice destination (it's the
    // ``on_*:`` key the writer renders under). Mirror the new
    // trigger id into the location so save/delete target the right
    // range. ``interval`` / ``script`` / ``light_effect`` carry no
    // ``trigger`` field. The catalog-qualified vs bare-YAML-key id
    // forms are documented in ``trigger-identity.ts``.
    if (this.location?.kind === "device_on") {
      this.location = { ...this.location, trigger: e.detail.triggerId };
    } else if (this.location?.kind === "component_on") {
      const bare = bareTriggerKey(e.detail.triggerId);
      this.location = { ...this.location, trigger: bare };
    }
  };

  private _onTriggerParamsChange = (
    e: CustomEvent<{ params: Record<string, unknown> }>
  ) => {
    e.stopPropagation();
    this._engine.withValue({ trigger_params: e.detail.params });
  };

  private _onActionsChange = (e: CustomEvent<{ actions: AutomationTree["actions"] }>) => {
    e.stopPropagation();
    this._engine.withValue({ actions: e.detail.actions });
  };

  // ─── Delete ──────────────────────────────────────────────────

  private _onDelete = () => {
    void this._engine.delete();
  };

  /** Filter declaration for the action buttons (referenced from
   *  the inline styles to keep the editor.styles file generic). */
  static get _actionStyles() {
    return null;
  }

  /**
   * Devices forwarded to sub-pickers — exposed for tests.
   * @internal
   */
  public get _devicesForTest(): AvailableComponentInstance[] {
    return this._available?.devices ?? [];
  }

  /** Scripts forwarded to sub-pickers — exposed for tests. @internal */
  public get _scriptsForTest(): AvailableScript[] {
    return this._available?.scripts ?? [];
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-automation-editor": ESPHomeAutomationEditor;
  }
}
