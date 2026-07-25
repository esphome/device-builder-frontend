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
import { mdiOpenInNew, mdiScriptTextOutline } from "@mdi/js";
import { html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";

import type {
  AutomationLocation,
  AutomationTree,
} from "../../../api/types/automations.js";
import type { ComponentCatalogEntry } from "../../../api/types/components.js";
import { ESPHOME_DOCS_BASE } from "../../../common/docs.js";
import {
  fetchComponent,
  getCachedComponent,
} from "../../../util/component-name-cache.js";
import { normalizeEspHomeId } from "../../../util/esphome-id.js";
import { renderMarkdown } from "../../../util/markdown.js";
import { registerMdiIcons } from "../../../util/register-icons.js";
import "../config-entry-form.js";
import {
  actionsFocus,
  type AutomationFocus,
  entryFieldFocus,
  focusKey,
  paramFocus,
} from "./automation-focus.js";
import { CallableAutomationEditor } from "./callable-editor.js";
import { renderActionsSection } from "./render-actions-section.js";
import "./callable-params-editor.js";
import { applyParamChange, emptyAutomationTree } from "./serialise.js";

/** ``AutomationLocation`` variant for top-level ``script:`` blocks
 *  — pulled out as a separate type because the script editor only
 *  ever holds this kind. */
type ScriptLocation = Extract<AutomationLocation, { kind: "script" }>;

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/option/option.js";
import "@home-assistant/webawesome/dist/components/select/select.js";

registerMdiIcons({
  "open-in-new": mdiOpenInNew,
  "script-text-outline": mdiScriptTextOutline,
});

@customElement("esphome-script-editor")
export class ESPHomeScriptEditor extends CallableAutomationEditor<ScriptLocation> {
  /** ``focusKey`` already advanced-revealed — one-shot per target so a
   *  later deliberate collapse sticks. */
  private _paramsRevealKey?: string;

  /** The Parameters block hides behind the advanced toggle; reveal it
   *  when the cursor targets a parameter so the row can render. */
  protected willUpdate(): void {
    const focus = this._resolveFocus(this.value, this.location, this.focusYamlPath);
    const key = focusKey(focus);
    if (key === this._paramsRevealKey) return;
    this._paramsRevealKey = key;
    if (paramFocus(focus, "parameters") !== null) this._showAdvanced = true;
  }

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

  // Can't upsert a script with no id.
  protected override _canApply(location: AutomationLocation): boolean {
    return location.kind === "script" && !!location.id;
  }

  protected readonly _sectionKind = "script" as const;

  protected _identityOf(location: ScriptLocation): string {
    return location.id;
  }

  /** The script-component fetch rides along with the shared load. */
  protected override async _load() {
    await super._load();
    void this._loadScriptComponent();
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

  protected render() {
    const gate = this.renderStateGate();
    if (gate) return gate;
    const automation = this.value ?? emptyAutomationTree();
    const devices = this._available?.devices ?? [];
    const scripts = this._available?.scripts ?? [];
    const actions = this._available?.actions ?? [];
    const conditions = this._available?.conditions ?? [];
    const disabled = this._engine.deleting;
    const focus = this._resolveFocus(this.value, this.location, this.focusYamlPath);
    return html`
      ${this._renderHeader()} ${this._renderConfigForm(automation, disabled, focus)}
      ${
        this._showAdvanced
          ? this._renderParametersField(automation, disabled, focus)
          : nothing
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
        focusTarget: actionsFocus(focus),
        descriptionKey: "device.script_actions_description",
        onActionsChange: this._onActionsChange,
      })}
      ${this.renderFooter({
        label: this._localize("device.delete_script"),
        message: (location) =>
          this._localize("device.confirm_delete_script", { name: location.id }),
      })}
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
  private _renderConfigForm(
    automation: AutomationTree,
    disabled: boolean,
    focus: AutomationFocus | null
  ) {
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
        .focusFieldPath=${
          paramFocus(focus, "parameters") === null ? entryFieldFocus(focus) : undefined
        }
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
  private _renderParametersField(
    automation: AutomationTree,
    disabled: boolean,
    focus: AutomationFocus | null
  ) {
    const value = (automation.trigger_params.parameters ?? {}) as Record<string, string>;
    return html`<esphome-callable-params-editor
      .value=${value}
      .focusParam=${paramFocus(focus, "parameters")}
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
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-script-editor": ESPHomeScriptEditor;
  }
}
