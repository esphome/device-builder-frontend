/**
 * Top-level script editor — the structured form for a single
 * ``script:`` block in the device YAML.
 *
 * Scripts are reusable callable bodies, not triggered automations.
 * They carry their own identity (``id``), execution mode
 * (``single`` / ``restart`` / ``queued`` / ``parallel``), declared
 * parameters, and a body that is a list of actions. They share the
 * recursive action-list component with ``<esphome-automation-editor>``
 * but live in their own surface because the chrome differs: scripts
 * have an id+mode header, no trigger, no condition gate at the top.
 *
 * Same public-surface conventions as the automation editor:
 *
 * - ``addMode`` distinguishes the wizard mount (id input + save into
 *   a new section) from the navigator-routed edit mount (id locked,
 *   value hydrated from the backend).
 * - Save / delete are optimistic + revert-on-failure (toast.error on
 *   failure); the editor's ``inFlightWrite`` guard signals to the
 *   parent's reconnect handler to skip clobbering an in-flight
 *   write.
 */
import { consume } from "@lit/context";
import { mdiDelete, mdiOpenInNew, mdiScriptTextOutline } from "@mdi/js";
import { html, LitElement, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";

import type { ESPHomeAPI } from "../../../api/index.js";
import type {
  AutomationLocation,
  AutomationTree,
  AvailableAutomations,
} from "../../../api/types/automations.js";
import type { BoardCatalogEntry } from "../../../api/types/boards.js";
import type { ComponentCatalogEntry } from "../../../api/types/components.js";
import { ESPHOME_DOCS_BASE } from "../../../common/docs.js";
import type { LocalizeFunc } from "../../../common/localize.js";
import { apiContext, localizeContext } from "../../../context/index.js";
import { inputStyles } from "../../../styles/inputs.js";
import { espHomeStyles } from "../../../styles/shared.js";
import {
  fetchComponent,
  getCachedComponent,
} from "../../../util/component-name-cache.js";
import { getErrorMessage } from "../../../util/error-message.js";
import { normalizeEspHomeId } from "../../../util/esphome-id.js";
import { renderMarkdown } from "../../../util/markdown.js";
import { registerMdiIcons } from "../../../util/register-icons.js";
import "../config-entry-form.js";
import { AutoApplyController } from "./auto-apply-controller.js";
import "./automation-action-list.js";
import type { ESPHomeAutomationActionList } from "./automation-action-list.js";
import { automationEditorStyles } from "./automation-editor.styles.js";
import "./callable-params-editor.js";
import { CatalogLoadController } from "./catalog-load-controller.js";
import { ParseErrorController } from "./parse-error-controller.js";
import { applyParamChange, emptyAutomationTree } from "./serialise.js";

/** ``AutomationLocation`` variant for top-level ``script:`` blocks
 *  — pulled out as a separate type because the script editor only
 *  ever holds this kind. */
type ScriptLocation = Extract<AutomationLocation, { kind: "script" }>;

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/option/option.js";
import "@home-assistant/webawesome/dist/components/select/select.js";
import "@home-assistant/webawesome/dist/components/spinner/spinner.js";

registerMdiIcons({
  delete: mdiDelete,
  "open-in-new": mdiOpenInNew,
  "script-text-outline": mdiScriptTextOutline,
});

@customElement("esphome-script-editor")
export class ESPHomeScriptEditor extends LitElement {
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
  location: ScriptLocation | null = null;

  /** True when mounted from the "+ Add script" wizard. Add-mode
   *  lets the user type the id; edit-mode locks it. */
  @property({ type: Boolean, attribute: "add-mode" })
  addMode = false;

  @property() yaml = "";

  /** Action-list reference — used by the header-positioned Add
   *  button to open the catalog picker dialog that lives inside
   *  the action-list component. */
  @query("esphome-automation-action-list")
  private _actionList?: ESPHomeAutomationActionList;

  @state() private _available: AvailableAutomations | null = null;
  @state() private _loading = true;
  @state() private _error = "";
  /** Renders read-only + blocks auto-apply for a parse-errored
   *  script so its empty tree can't overwrite the real YAML. */
  private readonly _parseError = new ParseErrorController(this);

  /** Component catalog entry for the ``script`` component, lazily
   *  fetched on mount. Drives the header (name / description /
   *  docs / image) and the inline config-entry form (``id``,
   *  ``mode``, ``max_runs`` — ``parameters`` and ``then`` stay
   *  under bespoke surfaces because the form's generic ``map``
   *  type wouldn't validate the typed-parameter shape). */
  @state() private _scriptComponent: ComponentCatalogEntry | null = null;

  /** Mirrors the automation editor: gates non-required entries
   *  in the form behind a toggle so the casual "id only" case
   *  isn't drowned out by the rarely-used options. */
  @state() private _showAdvanced = false;

  /** Shared auto-apply / delete / dirty-tracking engine — same
   *  instance shape as the automation and api-action editors so the
   *  page-level save guard can treat all three uniformly. */
  private readonly _engine = new AutoApplyController(this, {
    getApi: () => this._api,
    getLocalize: () => this._localize,
    isReadOnly: () => this._parseError.active,
    // Can't upsert a script with no id.
    canApply: (location) => location.kind === "script" && !!location.id,
    setError: (message) => {
      this._error = message;
    },
  });

  /** Catalog loader; owns the concurrency guard so overlapping loads
   *  (connectedCallback + updated both reaching ``_loadAvailable``)
   *  can't clobber ``_available`` or double-fire the toast. */
  private readonly _catalogLoad = new CatalogLoadController(this);

  public get dirty(): boolean {
    return this._engine.dirty;
  }

  public get inFlightWrite(): boolean {
    return this._engine.inFlightWrite;
  }

  static styles = [espHomeStyles, inputStyles, automationEditorStyles];

  connectedCallback(): void {
    super.connectedCallback();
    void this._load();
  }

  protected updated(changed: Map<string, unknown>) {
    if (changed.has("configuration")) {
      void this._loadAvailable();
    }
    // Navigator-driven location swap (user clicked a different
    // script in the navigator) — invalidate the stale value so
    // the hydrate path below re-fetches.
    if (changed.has("location") && !this.addMode) {
      const prev = changed.get("location") as ScriptLocation | null | undefined;
      if (prev && this.location && prev.id !== this.location.id) {
        this.value = null;
      }
    }
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
  }

  private async _load() {
    if (!this._api) return;
    this._loading = true;
    this._error = "";
    try {
      if (this.configuration) await this._loadAvailable();
      void this._loadScriptComponent();
    } catch (err) {
      this._error = getErrorMessage(err);
    } finally {
      this._loading = false;
    }
  }

  private async _loadAvailable() {
    // Hydrates config_entries (the slim catalog omits them); without
    // it every action renders fieldless since the node bails on an
    // empty config_entries list.
    this._error = "";
    const { available, error } = await this._catalogLoad.load(
      this._api,
      this.configuration,
      this._localize
    );
    if (error !== undefined) this._error = error;
    if (available) this._available = available;
  }

  /** Lazy fetch of the ``script`` component catalog entry. Reuses
   *  the shared component-name cache so a navigator pre-fetch
   *  (for the label) doubles as the editor's source. */
  private async _loadScriptComponent() {
    if (!this._api) return;
    const platform = this.platform || undefined;
    const boardId = this.board?.id;
    const cached = getCachedComponent("script", platform, boardId);
    if (cached) {
      this._scriptComponent = cached;
      return;
    }
    try {
      const entry = await fetchComponent(this._api, "script", platform, boardId);
      if (entry) this._scriptComponent = entry;
    } catch {
      /* swallow — the editor falls back to the static label if
         the catalog entry isn't available. */
    }
  }

  private async _hydrateFromBackend() {
    if (!this._api || !this.configuration || !this.location) return;
    try {
      // ``this.yaml`` override mirrors the automation-editor's
      // hydrate path: post-add the user's draft buffer holds the
      // new script, but the on-disk YAML doesn't yet. Without the
      // override the parse returns the stale on-disk state and the
      // form lands empty.
      const parsed = await this._api.parseDeviceAutomations(
        this.configuration,
        this.yaml
      );
      const m = this._parseError.resolve(parsed, this.location, "script");
      if (m) {
        this.location = m.location;
        this.value = m.tree;
      }
    } catch (err) {
      this._error =
        err instanceof Error
          ? err.message
          : this._localize("device.automation_parse_error");
    }
  }

  /**
   * Re-hydrate from the live YAML. Called by the parent
   * (``device-board-info``) when the YAML pane changes the document
   * out from under us — mirrors device-section-config.reload() and
   * automation-editor.reload() so editing YAML in the pane updates
   * the visual editor.
   */
  public reload(): void {
    if (this.addMode || !this.location) return;
    if (this._engine.shouldSkipReload()) return;
    void this._hydrateFromBackend();
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
    const devices = this._available?.devices ?? [];
    const scripts = this._available?.scripts ?? [];
    const actions = this._available?.actions ?? [];
    const conditions = this._available?.conditions ?? [];
    const disabled = this._engine.deleting;
    return html`
      ${this._renderHeader()} ${this._renderConfigForm(automation, disabled)}
      ${this._showAdvanced ? this._renderParametersField(automation, disabled) : nothing}
      <div class="field">
        <div class="ae-actions-header">
          <label class="field-label">
            ${this._localize("device.automation_action")}
          </label>
          <button
            type="button"
            class="ae-section-add"
            ?disabled=${disabled || actions.length === 0}
            @click=${() => this._actionList?.openPicker()}
          >
            <wa-icon library="mdi" name="plus"></wa-icon>
            ${this._localize("device.add_action")}
          </button>
        </div>
        <p class="field-description">
          ${renderMarkdown(this._localize("device.script_actions_description"))}
        </p>
        <esphome-automation-action-list
          no-header
          hide-add
          .actions=${automation.actions}
          .catalog=${actions}
          .conditionCatalog=${conditions}
          .scripts=${scripts}
          .devices=${devices}
          .board=${this.board}
          .yaml=${this.yaml}
          ?disabled=${disabled}
          @actions-change=${this._onActionsChange}
        ></esphome-automation-action-list>
      </div>
      ${this._error ? html`<p class="ae-error" role="alert">${this._error}</p>` : nothing}
      ${
        this.location && this.value && !this.addMode
          ? html`<div class="ae-actions">
              <button
                type="button"
                class="ae-danger"
                ?disabled=${disabled}
                @click=${this._onDelete}
              >
                <wa-icon library="mdi" name="delete"></wa-icon>
                ${this._localize("device.delete_script")}
              </button>
            </div>`
          : nothing
      }
    `;
  }

  /**
   * Component-style header card. Pulls the ``script`` component's
   * catalog entry (name / description / docs / image) when it's
   * loaded so the editor reads as the same kind of surface as the
   * regular component editor. Falls back to the local translation
   * keys before the catalog lands.
   */
  private _renderHeader() {
    const comp = this._scriptComponent;
    const title = comp?.name ?? this._localize("device.script_header_title_static");
    const descText =
      comp?.description ?? this._localize("device.script_header_description");
    const docsUrl = comp?.docs_url ?? `${ESPHOME_DOCS_BASE}/components/script.html`;
    const imageUrl = comp?.image_url ?? "";
    return html`<div class="ae-header">
      <div class="ae-header-text">
        <h2 class="ae-header-title">${title}</h2>
        <a class="ae-header-docs" href=${docsUrl} target="_blank" rel="noreferrer">
          ${this._localize("device.docs")}
          <wa-icon library="mdi" name="open-in-new"></wa-icon>
        </a>
        <p class="ae-header-desc">${renderMarkdown(descText)}</p>
      </div>
      <div class="ae-header-icon">
        ${
          imageUrl
            ? html`<img alt="" src=${imageUrl} />`
            : html`<wa-icon library="mdi" name="script-text-outline"></wa-icon>`
        }
      </div>
    </div>`;
  }

  /**
   * Inline ``<esphome-config-entry-form>`` driven by the script
   * component's catalog config_entries — gives us the same form
   * surface a regular component gets (catalog descriptions, id /
   * mode / max_runs renderers, advanced-toggle, validation) for
   * free.
   *
   * ``parameters`` and ``then`` are filtered out: ``parameters``
   * has a typed-declaration UI that's still bespoke (the generic
   * map renderer can't validate the ``{name: type}`` constraint),
   * and ``then`` is the actions block, rendered by the action-list
   * below the form.
   */
  private _renderConfigForm(automation: AutomationTree, disabled: boolean) {
    const comp = this._scriptComponent;
    if (!comp) return nothing;
    const entries = comp.config_entries.filter(
      (e) => e.key !== "parameters" && e.key !== "then"
    );
    const hasParameters = this._hasParametersEntry();
    if (entries.length === 0 && !hasParameters) return nothing;
    // The form owns the "Advanced settings" control; it also gates the bespoke
    // Parameters block (rendered below, outside the form) via the same switch,
    // so force the control on when parameters exist and count it as one item.
    return html`
      <esphome-config-entry-form
        .entries=${entries}
        .values=${automation.trigger_params}
        .board=${this.board}
        .yaml=${this.yaml}
        ?disabled=${disabled}
        advanced-section
        ?force-advanced-control=${hasParameters}
        .advancedExtraCount=${hasParameters ? 1 : 0}
        ?show-advanced=${this._showAdvanced}
        @value-change=${this._onConfigFormValueChange}
        @advanced-toggle=${this._onAdvancedToggle}
      ></esphome-config-entry-form>
    `;
  }

  private _onAdvancedToggle = (e: CustomEvent<{ show: boolean }>) => {
    this._showAdvanced = e.detail.show;
  };

  /** Does the script catalog define a ``parameters`` entry? Used to
   *  decide whether to show the advanced toggle even when the form
   *  itself has no non-required fields — Parameters is gated by the
   *  same switch. */
  private _hasParametersEntry(): boolean {
    return (
      this._scriptComponent?.config_entries.some((e) => e.key === "parameters") ?? false
    );
  }

  /** Bridge ``<esphome-config-entry-form>`` patch events into the
   *  AutomationTree shape. Special-cases the ``id`` field: changing
   *  it has to also mutate ``this.location`` because the YAML splice
   *  destination is keyed by location.id — without the mirror the
   *  next upsert would target the OLD slot. */
  private _onConfigFormValueChange = (
    e: CustomEvent<{ path: string[]; value: unknown }>
  ) => {
    e.stopPropagation();
    const { path, value } = e.detail;
    const automation = this.value ?? emptyAutomationTree();
    // ``id`` runs through the shared normalizer so a stray space or
    // dash the user typed lands as a valid YAML key
    // (``"my script"`` → ``"my_script"``) — without this the input
    // would round-trip a value that breaks compilation on save.
    const normalizedValue =
      path.length === 1 && path[0] === "id"
        ? normalizeEspHomeId(String(value ?? ""))
        : value;
    const next = applyParamChange(automation.trigger_params, path, normalizedValue);
    if (path.length === 1 && path[0] === "id") {
      // Match wire shape: ``trigger_params.id`` round-trips with
      // ``location.id``, so keep both pinned to the normalized id.
      // Empty id falls back to the previous location so we don't
      // dispatch a write with no destination.
      const newId = String(normalizedValue ?? "");
      if (newId) {
        this.location = { kind: "script", id: newId };
      }
    }
    this._engine.withValue({ trigger_params: next });
  };

  /**
   * Declared parameter list. ``{name: type}`` map under
   * ``trigger_params.parameters``. The actual list editing UI
   * lives in the shared ``<esphome-callable-params-editor>``; we
   * just wire the wire-shape in and out of it here.
   */
  private _renderParametersField(automation: AutomationTree, disabled: boolean) {
    const value = (automation.trigger_params.parameters ?? {}) as Record<string, string>;
    return html`<esphome-callable-params-editor
      .value=${value}
      ?disabled=${disabled}
      .fieldLabel=${this._localize("device.automation_script_parameters")}
      .description=${this._localize("device.script_parameters_description")}
      .addLabel=${this._localize("device.script_add_parameter")}
      .namePlaceholder=${this._localize("device.script_parameter_name_placeholder")}
      @value-change=${this._onParametersChange}
    ></esphome-callable-params-editor>`;
  }

  private _onParametersChange = (e: CustomEvent<{ value: Record<string, string> }>) => {
    e.stopPropagation();
    const automation = this.value ?? emptyAutomationTree();
    this._engine.withValue({
      trigger_params: {
        ...automation.trigger_params,
        parameters: e.detail.value,
      },
    });
  };

  private _onActionsChange = (e: CustomEvent<{ actions: AutomationTree["actions"] }>) => {
    e.stopPropagation();
    this._engine.withValue({ actions: e.detail.actions });
  };

  public flushPending(): Promise<void> {
    return this._engine.flushPending();
  }

  private _onDelete = () => {
    void this._engine.delete();
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-script-editor": ESPHomeScriptEditor;
  }
}
