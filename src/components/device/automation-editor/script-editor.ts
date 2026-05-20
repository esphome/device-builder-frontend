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
import toast from "sonner-js";
import { html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  mdiClose,
  mdiDelete,
  mdiOpenInNew,
  mdiPlus,
  mdiScriptTextOutline,
} from "@mdi/js";

import type { ESPHomeAPI } from "../../../api/index.js";
import type {
  AutomationLocation,
  AutomationTree,
  AvailableAutomations,
  BoardCatalogEntry,
  ComponentCatalogEntry,
  ConfigEntry,
  YamlDiff,
} from "../../../api/types.js";

/** ``AutomationLocation`` variant for top-level ``script:`` blocks
 *  — pulled out as a separate type because the script editor only
 *  ever holds this kind. */
type ScriptLocation = Extract<AutomationLocation, { kind: "script" }>;
import type { LocalizeFunc } from "../../../common/localize.js";
import { apiContext, localizeContext } from "../../../context/index.js";
import { espHomeStyles } from "../../../styles/shared.js";
import { inputStyles } from "../../../styles/inputs.js";
import { registerMdiIcons } from "../../../util/register-icons.js";
import { renderMarkdown } from "../../../util/markdown.js";
import { anyAdvancedEntry } from "../../../util/config-entry-tree.js";
import {
  fetchComponent,
  getCachedComponent,
} from "../../../util/component-name-cache.js";
import { automationEditorStyles } from "./automation-editor.styles.js";
import {
  applyYamlDiff,
  emptyAutomationTree,
  sectionKeyFromLocation,
} from "./serialise.js";
import "../config-entry-form.js";
import "./automation-action-list.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/option/option.js";
import "@home-assistant/webawesome/dist/components/select/select.js";
import "@home-assistant/webawesome/dist/components/spinner/spinner.js";
import "@home-assistant/webawesome/dist/components/switch/switch.js";

registerMdiIcons({
  close: mdiClose,
  delete: mdiDelete,
  "open-in-new": mdiOpenInNew,
  plus: mdiPlus,
  "script-text-outline": mdiScriptTextOutline,
});

/** One declared script parameter — captures the {name, type} pair
 *  that round-trips through ``triggerParams.parameters`` as a
 *  ``{name: type}`` map. Local to the editor since the wire shape
 *  is just the map. */
interface ParameterDecl {
  name: string;
  type: string;
}

/** Parameter types supported by ESPHome's script: ``parameters:``
 *  block. The catalog already validates these on save, so we just
 *  pin the user to the same set here. */
const PARAM_TYPES = ["int", "float", "bool", "string"] as const;

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

  @state() private _available: AvailableAutomations | null = null;
  @state() private _loading = true;
  @state() private _deleting = false;
  @state() private _error = "";

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

  /** Debounce timer + in-flight guard for the auto-apply path —
   *  same pattern as the automation editor. Each value change
   *  schedules an upsert that applies the returned diff to the
   *  page's YAML buffer; the global save button writes it. */
  private _applyTimer: ReturnType<typeof setTimeout> | null = null;
  private _applyInFlight = false;
  private _applyDirty = false;

  /** Brief-window dirty flag mirroring the automation editor —
   *  covers the 200ms debounce gap so the page's unsaved-changes
   *  guard fires immediately on edit. */
  @state() private _dirty = false;

  public get dirty(): boolean {
    return this._dirty;
  }

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

  /**
   * Working list for the parameter editor. The wire shape is a
   * ``{name: type}`` dict (per ESPHome's YAML), which collapses
   * empty-name entries and can't represent two in-progress rows.
   * We keep an editable list locally and project named entries
   * down to the wire on each change; empty-name rows persist
   * locally until the user fills them in.
   */
  @state() private _params: ParameterDecl[] = [];


  public get inFlightWrite(): boolean {
    return this._deleting || this._applyInFlight;
  }

  static styles = [espHomeStyles, inputStyles, automationEditorStyles];

  connectedCallback(): void {
    super.connectedCallback();
    void this._load();
    // Announce so the device page can call flushPending() before
    // its global save. Mirrors device-section-config.
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
    if (this._applyTimer) {
      clearTimeout(this._applyTimer);
      this._applyTimer = null;
    }
    this.dispatchEvent(
      new CustomEvent("section-unmount", {
        detail: { node: this },
        bubbles: true,
        composed: true,
      }),
    );
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
    // Sync the local parameter list when ``value`` arrives from
    // outside (hydrate). We can't tell our own write from an
    // external mutation cleanly, so use a conservative check: if
    // the wire's named entries match what we have locally (minus
    // empty-name rows we're holding), don't disturb the local
    // state.
    if (changed.has("value")) {
      const fromWire = this._readParams(
        this.value ?? emptyAutomationTree(),
      );
      const localNamed = this._params.filter((p) => p.name);
      const matches =
        localNamed.length === fromWire.length &&
        localNamed.every(
          (p, i) =>
            p.name === fromWire[i].name && p.type === fromWire[i].type,
        );
      if (!matches) this._params = fromWire;
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
      this._error = err instanceof Error ? err.message : String(err);
    } finally {
      this._loading = false;
    }
  }

  private async _loadAvailable() {
    if (!this._api || !this.configuration) return;
    try {
      this._available = await this._api.getAvailableAutomations(
        this.configuration,
      );
    } catch (err) {
      this._error = err instanceof Error ? err.message : String(err);
    }
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
        this.yaml,
      );
      const wantKey = sectionKeyFromLocation(this.location);
      const match = parsed.find(
        (p) => sectionKeyFromLocation(p.location) === wantKey,
      );
      if (match && match.location.kind === "script") {
        this.value = match.automation;
        this.location = match.location;
      }
    } catch (err) {
      this._error =
        err instanceof Error
          ? err.message
          : this._localize("device.automation_parse_error");
    }
  }

  protected render() {
    if (this._loading) {
      return html`<div class="ae-empty">
        <wa-spinner></wa-spinner>
        ${this._localize("device.loading_automation_catalog")}
      </div>`;
    }
    const automation = this.value ?? emptyAutomationTree();
    const devices = this._available?.devices ?? [];
    const scripts = this._available?.scripts ?? [];
    const actions = this._available?.actions ?? [];
    const conditions = this._available?.conditions ?? [];
    const disabled = this._deleting;
    return html`
      ${this._renderHeader()}
      ${this._renderConfigForm(automation, disabled)}
      ${this._showAdvanced
        ? this._renderParametersField(automation, disabled)
        : nothing}
      <div class="field">
        <label class="field-label">
          ${this._localize("device.automation_action")}
        </label>
        <p class="field-description">
          ${renderMarkdown(
            this._localize("device.script_actions_description"),
          )}
        </p>
        <esphome-automation-action-list
          no-header
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
      ${this._error
        ? html`<p class="ae-error" role="alert">${this._error}</p>`
        : nothing}
      ${this.location && this.value && !this.addMode
        ? html`<div class="ae-actions">
            <button
              type="button"
              class="ae-danger"
              ?disabled=${disabled}
              @click=${this._onDelete}
            >
              <wa-icon library="mdi" name="delete"></wa-icon>
              ${this._localize("dashboard.delete")}
            </button>
          </div>`
        : nothing}
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
    const title =
      comp?.name ?? this._localize("device.script_header_title_static");
    const descText =
      comp?.description ?? this._localize("device.script_header_description");
    const docsUrl = comp?.docs_url ?? "https://esphome.io/components/script.html";
    const imageUrl = comp?.image_url ?? "";
    return html`<div class="ae-header">
      <div class="ae-header-text">
        <h2 class="ae-header-title">${title}</h2>
        <a
          class="ae-header-docs"
          href=${docsUrl}
          target="_blank"
          rel="noreferrer"
        >
          ${this._localize("device.docs")}
          <wa-icon library="mdi" name="open-in-new"></wa-icon>
        </a>
        <p class="ae-header-desc">${renderMarkdown(descText)}</p>
      </div>
      <div class="ae-header-icon">
        ${imageUrl
          ? html`<img alt="" src=${imageUrl} />`
          : html`<wa-icon
              library="mdi"
              name="script-text-outline"
            ></wa-icon>`}
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
  private _renderConfigForm(
    automation: AutomationTree,
    disabled: boolean,
  ) {
    const comp = this._scriptComponent;
    if (!comp) return nothing;
    const entries = comp.config_entries.filter(
      (e) => e.key !== "parameters" && e.key !== "then",
    );
    if (entries.length === 0) return nothing;
    // The form is its own flex-column with gap, and the toggle and
    // parameters/actions sit as siblings of it at the editor's root.
    // No outer ``.field`` wrapper: that would add a label-shaped
    // empty row of vertical rhythm above the form's first row, which
    // is what made the spacing look "off" against the bespoke
    // Parameters / Actions sections.
    return html`
      <esphome-config-entry-form
        .entries=${entries}
        .values=${automation.trigger_params}
        .board=${this.board}
        .yaml=${this.yaml}
        ?disabled=${disabled}
        ?show-advanced=${this._showAdvanced}
        @value-change=${this._onConfigFormValueChange}
      ></esphome-config-entry-form>
      ${this._renderAdvancedToggle(entries)}
    `;
  }

  /** "Show advanced settings" toggle row. Pulled out so the same
   *  toggle can drive both the form's advanced fields AND the
   *  bespoke Parameters block — keeping them gated behind a single
   *  switch matches the user's expectation that "advanced" is one
   *  surface, not per-section. */
  private _renderAdvancedToggle(entries: ConfigEntry[]) {
    // Always show the toggle when ``parameters`` exists in the
    // component schema (it does), even if the entries we're handing
    // the form have no non-required fields — the toggle is now also
    // gating the Parameters editor.
    const hasAdvanced =
      anyAdvancedEntry(entries) || this._hasParametersEntry();
    if (!hasAdvanced) return nothing;
    return html`<div class="advanced-toggle-row">
      <wa-switch
        .checked=${this._showAdvanced}
        @change=${(e: Event) => {
          this._showAdvanced = (
            e.target as HTMLInputElement & { checked: boolean }
          ).checked;
        }}
      >
        ${this._localize("device.show_advanced")}
      </wa-switch>
    </div>`;
  }

  /** Does the script catalog define a ``parameters`` entry? Used to
   *  decide whether to show the advanced toggle even when the form
   *  itself has no non-required fields — Parameters is gated by the
   *  same switch. */
  private _hasParametersEntry(): boolean {
    return (
      this._scriptComponent?.config_entries.some(
        (e) => e.key === "parameters",
      ) ?? false
    );
  }

  /** Bridge ``<esphome-config-entry-form>`` patch events into the
   *  AutomationTree shape. Special-cases the ``id`` field: changing
   *  it has to also mutate ``this.location`` because the YAML splice
   *  destination is keyed by location.id — without the mirror the
   *  next upsert would target the OLD slot. */
  private _onConfigFormValueChange = (
    e: CustomEvent<{ path: string[]; value: unknown }>,
  ) => {
    e.stopPropagation();
    const { path, value } = e.detail;
    const automation = this.value ?? emptyAutomationTree();
    const next = this._patchParams(automation.trigger_params, path, value);
    if (path.length === 1 && path[0] === "id") {
      // Match wire shape: ``trigger_params.id`` round-trips with
      // ``location.id``, so keep both pinned to whatever the user
      // typed. Empty id falls back to the previous location so we
      // don't dispatch a write with no destination.
      const newId = String(value ?? "").trim();
      if (newId) {
        this.location = { kind: "script", id: newId };
      }
    }
    this._withValue({ trigger_params: next });
  };

  /** Shallow path patch — mirrors automation-editor's helper but
   *  inlined here because the script form's shape is flat (one
   *  level of keys). Returning a fresh object so Lit's
   *  property-update mechanism actually re-renders. */
  private _patchParams(
    params: Record<string, unknown>,
    path: string[],
    value: unknown,
  ): Record<string, unknown> {
    if (path.length === 0) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return { ...(value as Record<string, unknown>) };
      }
      return {};
    }
    const [head] = path;
    if (value === undefined || value === "") {
      const next = { ...params };
      delete next[head];
      return next;
    }
    return { ...params, [head]: value };
  }

  /**
   * Declared parameter list. ``{name: type}`` map under
   * ``triggerParams.parameters``. Rendered as one row per declared
   * parameter with a remove button + a footer "+ Add parameter".
   */
  private _renderParametersField(
    _automation: AutomationTree,
    disabled: boolean,
  ) {
    const params = this._params;
    return html`<div class="field">
      <label class="field-label">
        ${this._localize("device.automation_script_parameters")}
      </label>
      <p class="field-description">
        ${renderMarkdown(
          this._localize("device.script_parameters_description"),
        )}
      </p>
      ${params.length === 0
        ? nothing
        : html`<div class="script-params-list">
            ${params.map((p, idx) =>
              this._renderParameterRow(p, idx, disabled),
            )}
          </div>`}
      <button
        type="button"
        class="script-param-add"
        ?disabled=${disabled}
        @click=${this._addParam}
      >
        <wa-icon library="mdi" name="plus"></wa-icon>
        ${this._localize("device.script_add_parameter")}
      </button>
    </div>`;
  }

  private _renderParameterRow(
    p: ParameterDecl,
    idx: number,
    disabled: boolean,
  ) {
    return html`<div class="script-param-row">
      <input
        type="text"
        ?disabled=${disabled}
        placeholder=${this._localize(
          "device.script_parameter_name_placeholder",
        )}
        .value=${p.name}
        @input=${(e: Event) =>
          this._updateParam(idx, {
            ...p,
            name: (e.target as HTMLInputElement).value,
          })}
      />
      <wa-select
        value=${p.type}
        ?disabled=${disabled}
        @change=${(e: Event) =>
          this._updateParam(idx, {
            ...p,
            type: (e.target as HTMLSelectElement).value,
          })}
      >
        ${PARAM_TYPES.map(
          (t) => html`<wa-option value=${t} ?selected=${t === p.type}
            >${t}</wa-option
          >`,
        )}
      </wa-select>
      <button
        type="button"
        class="script-param-remove"
        ?disabled=${disabled}
        aria-label=${this._localize("device.automation_remove")}
        @click=${() => this._removeParam(idx)}
      >
        <wa-icon library="mdi" name="close"></wa-icon>
      </button>
    </div>`;
  }

  private _readParams(automation: AutomationTree): ParameterDecl[] {
    const raw = automation.trigger_params.parameters;
    if (!raw || typeof raw !== "object") return [];
    return Object.entries(raw as Record<string, unknown>).map(
      ([name, type]) => ({ name, type: String(type ?? "string") }),
    );
  }

  /**
   * Push the local parameter list down to the wire. Empty-name
   * rows persist in the local state but are NOT written to the
   * wire dict (the wire shape is keyed by name and can't represent
   * unnamed in-progress entries). They become visible to the
   * writer only when the user fills the name in.
   */
  private _writeParams(list: ParameterDecl[]) {
    this._params = list;
    const dict: Record<string, string> = {};
    for (const { name, type } of list) {
      if (name) dict[name] = type;
    }
    const automation = this.value ?? emptyAutomationTree();
    this._withValue({
      trigger_params: { ...automation.trigger_params, parameters: dict },
    });
  }

  private _addParam = () => {
    this._writeParams([...this._params, { name: "", type: "int" }]);
  };

  private _updateParam(idx: number, value: ParameterDecl) {
    const list = this._params.slice();
    list[idx] = value;
    this._writeParams(list);
  }

  private _removeParam(idx: number) {
    const list = this._params.slice();
    list.splice(idx, 1);
    this._writeParams(list);
  }

  private _onActionsChange = (
    e: CustomEvent<{ actions: AutomationTree["actions"] }>,
  ) => {
    e.stopPropagation();
    this._withValue({ actions: e.detail.actions });
  };

  private _withValue(patch: Partial<AutomationTree>) {
    const value: AutomationTree = {
      ...(this.value ?? emptyAutomationTree()),
      ...patch,
    };
    this.value = value;
    this.dispatchEvent(
      new CustomEvent("automation-change", {
        detail: { value, location: this.location },
        bubbles: true,
        composed: true,
      }),
    );
    this._scheduleAutoApply();
  }

  /**
   * Schedule a debounced upsert. The page's YAML buffer
   * advances on every committed change so the user sees their
   * edits in the YAML pane immediately, and the global save
   * button activates. The user explicitly saves via that global
   * button.
   */
  private _scheduleAutoApply() {
    if (this.addMode) return;
    this._setDirty(true);
    if (this._applyTimer) clearTimeout(this._applyTimer);
    this._applyTimer = setTimeout(() => {
      this._applyTimer = null;
      void this._autoApply();
    }, 200);
  }

  private async _autoApply(): Promise<void> {
    if (!this._api || !this.location || !this.value) return;
    if (!this.location.id) return; // can't upsert a script with no id
    if (this._applyInFlight) {
      this._applyDirty = true;
      return;
    }
    this._applyInFlight = true;
    this._applyDirty = false;
    try {
      const { yaml_diff } = await this._api.upsertAutomation(
        this.configuration,
        this.value,
        this.location,
        this.yaml,
      );
      const newYaml = applyYamlDiff(this.yaml, yaml_diff);
      this.dispatchEvent(
        new CustomEvent<{ yaml: string }>("yaml-draft", {
          detail: { yaml: newYaml },
          bubbles: true,
          composed: true,
        }),
      );
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : this._localize("device.automation_save_error");
      this._error = msg;
      toast.error(this._localize("device.automation_save_error"), {
        description: msg,
        richColors: true,
      });
    } finally {
      this._applyInFlight = false;
      if (this._applyDirty) {
        this._applyDirty = false;
        void this._autoApply();
      } else {
        this._setDirty(false);
      }
    }
  }

  public async flushPending(): Promise<void> {
    if (this._applyTimer) {
      clearTimeout(this._applyTimer);
      this._applyTimer = null;
      await this._autoApply();
    } else if (this._applyInFlight) {
      while (this._applyInFlight) {
        await new Promise((r) => setTimeout(r, 20));
      }
    }
  }

  /**
   * Delete writes to disk via ``api.updateConfig`` after applying
   * the backend's delete diff (matches the component editor's
   * delete UX in ``device-section-config/draft-and-delete``).
   * Dispatches ``yaml-updated`` so the page advances both
   * ``_yaml`` AND ``_savedYaml`` (clean state). Navigates away
   * from the deleted section.
   */
  private _onDelete = async () => {
    if (!this._api || !this.location || this._deleting) return;
    if (this._applyTimer) {
      clearTimeout(this._applyTimer);
      this._applyTimer = null;
    }
    this._deleting = true;
    this._error = "";
    try {
      const { yaml_diff } = await this._api.deleteAutomation(
        this.configuration,
        this.location,
        this.yaml,
      );
      const newYaml = applyYamlDiff(this.yaml, yaml_diff);
      await this._api.updateConfig(this.configuration, newYaml);
      this.dispatchEvent(
        new CustomEvent<{ yaml: string }>("yaml-updated", {
          detail: { yaml: newYaml },
          bubbles: true,
          composed: true,
        }),
      );
      this.dispatchEvent(
        new CustomEvent<{ sectionKey: string | null }>("section-select", {
          detail: { sectionKey: null },
          bubbles: true,
          composed: true,
        }),
      );
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : this._localize("device.automation_save_error");
      this._error = msg;
      toast.error(this._localize("device.automation_save_error"), {
        description: msg,
        richColors: true,
      });
    } finally {
      this._deleting = false;
    }
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-script-editor": ESPHomeScriptEditor;
  }
}
