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
import toast from "sonner-js";
import { html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  mdiArrowDecisionOutline,
  mdiContentSave,
  mdiDelete,
  mdiOpenInNew,
} from "@mdi/js";

import type { ESPHomeAPI } from "../../../api/index.js";
import type {
  AutomationLocation,
  AutomationTree,
  AutomationTrigger,
  AvailableAutomations,
  AvailableComponentInstance,
  AvailableScript,
  BoardCatalogEntry,
  YamlDiff,
} from "../../../api/types.js";
import type { LocalizeFunc } from "../../../common/localize.js";
import { apiContext, localizeContext } from "../../../context/index.js";
import { espHomeStyles } from "../../../styles/shared.js";
import { inputStyles } from "../../../styles/inputs.js";
import { registerMdiIcons } from "../../../util/register-icons.js";
import { renderMarkdown } from "../../../util/markdown.js";
import { automationEditorStyles } from "./automation-editor.styles.js";
import {
  emptyAutomationTree,
  sectionKeyFromLocation,
} from "./serialise.js";
import "./automation-target-picker.js";
import "./automation-trigger-picker.js";
import "./automation-action-list.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/spinner/spinner.js";

registerMdiIcons({
  "arrow-decision-outline": mdiArrowDecisionOutline,
  "content-save": mdiContentSave,
  delete: mdiDelete,
  "open-in-new": mdiOpenInNew,
});

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

  /** Scoped catalog response. Trigger / action / condition lists
   *  come from here (the backend filters to what's actually in the
   *  device's YAML) so the dropdowns only show what's usable. */
  @state() private _available: AvailableAutomations | null = null;

  @state() private _loading = true;
  @state() private _saving = false;
  @state() private _deleting = false;
  @state() private _error = "";

  /**
   * Derived: edit-mode = not add-mode. Snapshot taken in
   * ``connectedCallback`` so hydrate doesn't flip it back.
   */
  @state() private _editMode = false;

  /** In-flight write guard — parents that re-fetch on reconnect
   *  should consult this to skip clobbering an optimistic update. */
  public get inFlightWrite(): boolean {
    return this._saving || this._deleting;
  }

  static styles = [espHomeStyles, inputStyles, automationEditorStyles];

  connectedCallback(): void {
    super.connectedCallback();
    // Snapshot the add-vs-edit context once at mount so subsequent
    // property changes (the hydrate-from-backend cycle fills value
    // and re-pins location) don't accidentally unlock the picker
    // after it should stay locked.
    this._editMode = !this.addMode;
    void this._loadCatalogs();
  }

  protected updated(changed: Map<string, unknown>) {
    if (changed.has("configuration")) {
      void this._loadAvailable();
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
      const parsed = await this._api.parseDeviceAutomations(this.configuration);
      const wantKey = sectionKeyFromLocation(this.location);
      const match = parsed.find(
        (p) => sectionKeyFromLocation(p.location) === wantKey,
      );
      if (match) {
        this.value = match.automation;
        // Re-pin location so the writer round-trips with the parser's
        // canonical form (script id matched, light_effect index
        // resolved against the actual YAML, …).
        this.location = match.location;
      }
    } catch (err) {
      this._error =
        err instanceof Error
          ? err.message
          : this._localize("device.automation_parse_error");
    }
  }

  private async _loadCatalogs() {
    if (!this._api) return;
    this._loading = true;
    this._error = "";
    try {
      if (this.configuration) await this._loadAvailable();
    } catch (err) {
      this._error = err instanceof Error ? err.message : String(err);
    } finally {
      this._loading = false;
    }
  }

  private async _loadAvailable() {
    if (!this._api || !this.configuration) return;
    try {
      this._available = await this._api.getAvailableAutomations(this.configuration);
    } catch (err) {
      this._error = err instanceof Error ? err.message : String(err);
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
    const disabled = this._saving || this._deleting;
    // For ``device_on`` and ``component_on`` the trigger lives in the
    // location alongside the YAML splice destination. Mirror it into
    // the editor's effective trigger id so the picker shows the right
    // selection on first paint without a manual sync step.
    //
    // ``trigger_id`` is the catalog-qualified id
    // (``"switch.on_turn_on"``). ``location.trigger`` is the bare
    // YAML key (``"on_turn_on"``) the writer splices under the
    // component. For ``device_on`` the two coincide because
    // device-level catalog ids carry no domain prefix.
    const effectiveTriggerId =
      automation.trigger_id ??
      (target?.kind === "device_on"
        ? target.trigger || null
        : target?.kind === "component_on"
          ? this._catalogIdFor(target) || null
          : null);
    const activeTrigger = effectiveTriggerId
      ? triggers.find((t) => t.id === effectiveTriggerId) ?? null
      : null;
    return html`
      ${this._renderHeader(activeTrigger)}
      ${this.addMode
        ? this._renderAddModePickers(
            target,
            triggers,
            devices,
            scripts,
            effectiveTriggerId,
            automation,
            disabled,
          )
        : html`${this._renderIdentityFields(activeTrigger)}${this._renderTriggerParamsForm(
            activeTrigger,
            automation,
            disabled,
          )}`}
      <div class="field">
        <label class="field-label">
          ${this._localize("device.automation_action")}
        </label>
        <p class="field-description">
          ${renderMarkdown(
            this._localize("device.automation_actions_description"),
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
      <div class="ae-actions">
        <button
          type="button"
          class="ae-primary"
          ?disabled=${disabled || !target}
          @click=${this._onSave}
        >
          <wa-icon library="mdi" name="content-save"></wa-icon>
          ${this._saving
            ? this._localize("device.saving")
            : this.addMode
              ? this._localize("device.add_automation")
              : this._localize("device.save")}
        </button>
        ${this.location && this.value && !this.addMode
          ? html`<button
              type="button"
              class="ae-danger"
              ?disabled=${disabled}
              @click=${this._onDelete}
            >
              <wa-icon library="mdi" name="delete"></wa-icon>
              ${this._localize("dashboard.delete")}
            </button>`
          : nothing}
      </div>
    `;
  }

  /**
   * Trigger param form for edit-mode. The target / trigger
   * dropdowns are gone — those become read-only metadata in the
   * header. Only the trigger's ``config_entries`` need a form,
   * since those ARE editable on an existing automation (e.g.
   * tweaking ``min_length`` on an ``on_click`` trigger after the
   * fact).
   */
  private _renderTriggerParamsForm(
    activeTrigger: AutomationTrigger | null,
    automation: AutomationTree,
    disabled: boolean,
  ) {
    if (!activeTrigger || activeTrigger.config_entries.length === 0) {
      return nothing;
    }
    return html`<div class="field">
      <label class="field-label">
        ${this._localize("device.automation_trigger_options")}
      </label>
      <esphome-config-entry-form
        .entries=${activeTrigger.config_entries}
        .values=${automation.trigger_params}
        .board=${this.board}
        .yaml=${this.yaml}
        ?disabled=${disabled}
        @value-change=${this._onTriggerParamsValueChange}
      ></esphome-config-entry-form>
    </div>`;
  }

  /**
   * Legacy add-mode pickers. The "+ Add automation" wizard now
   * collects target / trigger before mounting the editor, so this
   * path isn't normally reached from the navigator — kept for
   * back-compat if a parent ever instantiates the editor in
   * add-mode directly.
   */
  private _renderAddModePickers(
    target: AutomationLocation | null,
    triggers: AutomationTrigger[],
    devices: AvailableComponentInstance[],
    scripts: AvailableScript[],
    effectiveTriggerId: string | null,
    automation: AutomationTree,
    disabled: boolean,
  ) {
    return html`
      <esphome-automation-target-picker
        .value=${target}
        .devices=${devices}
        .scripts=${scripts}
        ?disabled=${disabled}
        @target-change=${this._onTargetChange}
      ></esphome-automation-target-picker>
      <esphome-automation-trigger-picker
        .target=${target}
        .triggers=${triggers}
        .devices=${devices}
        .triggerId=${effectiveTriggerId}
        .triggerParams=${automation.trigger_params}
        .board=${this.board}
        .yaml=${this.yaml}
        ?disabled=${disabled}
        @trigger-change=${this._onTriggerChange}
        @trigger-params-change=${this._onTriggerParamsChange}
      ></esphome-automation-trigger-picker>
    `;
  }

  private _onTriggerParamsValueChange = (
    e: CustomEvent<{ path: string[]; value: unknown }>,
  ) => {
    e.stopPropagation();
    // Form's value-change events carry path-based updates; merge
    // into the trigger_params dict.
    const { path, value } = e.detail;
    const automation = this.value ?? emptyAutomationTree();
    const next = this._applyParamPatch(automation.trigger_params, path, value);
    this._withValue({ trigger_params: next });
  };

  /** Apply a single value-change patch into a params dict. */
  private _applyParamPatch(
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
    const [head, ...rest] = path;
    if (rest.length === 0) {
      if (value === undefined || value === "") {
        const next = { ...params };
        delete next[head];
        return next;
      }
      return { ...params, [head]: value };
    }
    const child =
      params[head] &&
      typeof params[head] === "object" &&
      !Array.isArray(params[head])
        ? (params[head] as Record<string, unknown>)
        : {};
    return {
      ...params,
      [head]: this._applyParamPatch(child, rest, value),
    };
  }

  /**
   * Component-style header card. Just the section type as a
   * title, the docs link, and a one-line description of what
   * automations are. The specific identity (target + trigger) is
   * carried by the read-only form fields below the header — no
   * subtitle here because it would just duplicate the trigger
   * field that's already in the form.
   */
  private _renderHeader(activeTrigger: AutomationTrigger | null) {
    const desc = activeTrigger?.description
      ? renderMarkdown(activeTrigger.description)
      : renderMarkdown(this._localize("device.automation_header_description"));
    return html`<div class="ae-header">
      <div class="ae-header-text">
        <h2 class="ae-header-title">
          ${this._localize("device.automation_header_title_static")}
        </h2>
        ${activeTrigger?.docs_url
          ? html`<a
              class="ae-header-docs"
              href=${activeTrigger.docs_url}
              target="_blank"
              rel="noreferrer"
            >
              ${this._localize("device.docs")}
              <wa-icon library="mdi" name="open-in-new"></wa-icon>
            </a>`
          : nothing}
        <p class="ae-header-desc">${desc}</p>
      </div>
      <div class="ae-header-icon">
        <wa-icon library="mdi" name="arrow-decision-outline"></wa-icon>
      </div>
    </div>`;
  }

  /**
   * Read-only target / trigger fields — styled like a component
   * config form so the eye reads them as the same kind of thing
   * as the editable rows above. The inputs are disabled (the
   * values are pinned for an existing automation) but still
   * convey the identity at a glance.
   */
  private _renderIdentityFields(activeTrigger: AutomationTrigger | null) {
    const loc = this.location;
    if (!loc) return nothing;
    const targetValue = this._targetMetadataValue(loc);
    const triggerValue = activeTrigger?.name ?? "";
    const showTrigger =
      loc.kind === "device_on" || loc.kind === "component_on";
    return html`
      <div class="field">
        <label class="field-label">
          ${this._localize("device.automation_target")}
        </label>
        <input type="text" readonly .value=${targetValue} />
      </div>
      ${showTrigger
        ? html`<div class="field">
            <label class="field-label">
              ${this._localize("device.automation_trigger")}
            </label>
            <input type="text" readonly .value=${triggerValue} />
          </div>`
        : nothing}
    `;
  }

  /**
   * Compose the single TARGET row value. For component_on this is
   * the bound device's display name + catalog id (e.g.
   * "Warmtepomp (switch.gpio)") — no separate "Which component?"
   * row. For device_on it's "The device itself"; for interval
   * it's "Interval #N"; for script / light_effect we fall back
   * to the kind label (those land in their own editors anyway).
   */
  private _targetMetadataValue(loc: AutomationLocation): string {
    switch (loc.kind) {
      case "device_on":
        return this._localize("device.automation_target_device");
      case "component_on": {
        const device = this._available?.devices.find(
          (d) => d.id === loc.component_id,
        );
        if (!device) return loc.component_id;
        const label = device.name ?? device.id;
        return `${label} (${device.component_id})`;
      }
      case "interval":
        return this._localize("device.automation_target_interval_n", {
          index: loc.index + 1,
        });
      case "script":
        return loc.id;
      case "light_effect":
        return loc.component_id;
    }
  }

  // ─── State mutations ─────────────────────────────────────────

  private _withValue(patch: Partial<AutomationTree>) {
    const value: AutomationTree = { ...(this.value ?? emptyAutomationTree()), ...patch };
    this.value = value;
    this.dispatchEvent(
      new CustomEvent("automation-change", {
        detail: { value, location: this.location },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _onTargetChange = (
    e: CustomEvent<{ target: AutomationLocation | null }>,
  ) => {
    e.stopPropagation();
    this.location = e.detail.target;
    // Reset trigger when switching target kinds — the previous
    // trigger id wouldn't apply to the new target's domain.
    this._withValue({ trigger_id: null, trigger_params: {} });
  };

  private _onTriggerChange = (
    e: CustomEvent<{ triggerId: string; params: Record<string, unknown> }>,
  ) => {
    e.stopPropagation();
    this._withValue({
      trigger_id: e.detail.triggerId,
      trigger_params: e.detail.params,
    });
    // For device-level and component-level automations the trigger
    // name is part of the YAML splice destination (it's the
    // ``on_*:`` key the writer renders under). Mirror the new
    // trigger id into the location so save/delete target the right
    // range. ``interval`` / ``script`` / ``light_effect`` carry no
    // ``trigger`` field.
    //
    // Wire-shape detail: ``AutomationTree.trigger_id`` is the
    // catalog-qualified id (``"switch.on_turn_on"`` — what
    // ``catalog.trigger_by_id`` returns a hit for).
    // ``location.component_on.trigger`` is the BARE YAML key
    // (``"on_turn_on"``) the writer splices under the component;
    // the backend reconstructs the catalog id by combining the
    // component's domain with the bare key. Device-level catalog
    // ids carry no domain prefix so the two coincide for
    // ``device_on``.
    if (this.location?.kind === "device_on") {
      this.location = { ...this.location, trigger: e.detail.triggerId };
    } else if (this.location?.kind === "component_on") {
      const bare = this._bareTriggerKey(e.detail.triggerId);
      this.location = { ...this.location, trigger: bare };
    }
  };

  /**
   * Drop the ``<domain>.`` prefix from a catalog trigger id to get
   * the bare YAML key. ``"switch.on_turn_on"`` → ``"on_turn_on"``.
   * Ids that already lack a domain are passed through.
   */
  private _bareTriggerKey(catalogId: string): string {
    const dotIdx = catalogId.indexOf(".");
    return dotIdx >= 0 ? catalogId.slice(dotIdx + 1) : catalogId;
  }

  /**
   * Build the catalog-qualified trigger id for a ``component_on``
   * location, using the bound device's domain. Returns ``null``
   * when the device isn't yet loaded or the location has no
   * trigger picked.
   */
  private _catalogIdFor(loc: AutomationLocation): string | null {
    if (loc.kind !== "component_on" || !loc.trigger) return null;
    const device = this._available?.devices.find((d) => d.id === loc.component_id);
    const domain = device?.component_id.split(".")[0] ?? null;
    return domain ? `${domain}.${loc.trigger}` : loc.trigger;
  }

  private _onTriggerParamsChange = (
    e: CustomEvent<{ params: Record<string, unknown> }>,
  ) => {
    e.stopPropagation();
    this._withValue({ trigger_params: e.detail.params });
  };

  private _onActionsChange = (
    e: CustomEvent<{ actions: AutomationTree["actions"] }>,
  ) => {
    e.stopPropagation();
    this._withValue({ actions: e.detail.actions });
  };

  // ─── Save / delete ───────────────────────────────────────────

  private _onSave = async () => {
    if (!this._api || !this.location || this._saving) return;
    const value = this.value ?? emptyAutomationTree();
    this._saving = true;
    this._error = "";
    try {
      const { yaml_diff } = await this._api.upsertAutomation(
        this.configuration,
        value,
        this.location,
      );
      this.dispatchEvent(
        new CustomEvent<{
          yamlDiff: YamlDiff;
          value: AutomationTree;
          location: AutomationLocation;
        }>("automation-save", {
          detail: { yamlDiff: yaml_diff, value, location: this.location },
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
      this._saving = false;
    }
  };

  private _onDelete = async () => {
    if (!this._api || !this.location || this._deleting) return;
    this._deleting = true;
    this._error = "";
    try {
      const { yaml_diff } = await this._api.deleteAutomation(
        this.configuration,
        this.location,
      );
      this.dispatchEvent(
        new CustomEvent<{ yamlDiff: YamlDiff; location: AutomationLocation }>(
          "automation-delete",
          {
            detail: { yamlDiff: yaml_diff, location: this.location },
            bubbles: true,
            composed: true,
          },
        ),
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
