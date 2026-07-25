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
import { html } from "lit";
import { customElement, state } from "lit/decorators.js";
import memoizeOne from "memoize-one";

import type {
  AutomationLocation,
  AutomationTrigger,
  AvailableComponentInstance,
  AvailableScript,
} from "../../../api/types/automations.js";
import type { ComponentCatalogEntry } from "../../../api/types/components.js";
import { automationHeaderTitle } from "../../../util/automation-header-title.js";
import { parseSubstitutions } from "../../../util/substitutions.js";
import { actionsFocus, entryFieldFocus } from "./automation-focus.js";
import { BaseAutomationEditor } from "./base-editor.js";
import { loadIntervalComponent } from "./load-interval-component.js";
import { renderAutomationHeader } from "./render-automation-header.js";
import { renderActionsSection } from "./render-actions-section.js";
import {
  renderAddModePickers,
  renderIdentityFields,
  renderTriggerParamsForm,
} from "./render-automation-sections.js";
import { applyParamChange, emptyAutomationTree } from "./serialise.js";
import { bareTriggerKey, effectiveTriggerIdFor } from "./trigger-identity.js";

@customElement("esphome-automation-editor")
export class ESPHomeAutomationEditor extends BaseAutomationEditor<AutomationLocation> {
  /** Component catalog entry for the ``interval`` component, lazily
   *  fetched the first time we render an interval automation. Drives
   *  the header (name / description / docs / image) and the inline
   *  config-entry form (the ``interval:`` time field that used to
   *  live in a dead "Target #N" readonly box). */
  @state() private _intervalComponent: ComponentCatalogEntry | null = null;

  /** "Show advanced settings" toggle state for the params form.
   *  Mirrors ``device-section-config``'s same-named state but
   *  scoped to this editor instance — switching away and back
   *  resets to collapsed, matching the component-editor UX. */
  @state() private _showAdvanced = false;

  /** Parse ``substitutions:`` from the current YAML once per edit so the
   *  read-only Target field can preview ${...} like the text fields do. */
  private _parseSubstitutions = memoizeOne(parseSubstitutions);

  connectedCallback(): void {
    super.connectedCallback();
    // ``_loadAvailable`` fires from ``updated()`` on the first
    // render once ``configuration`` lands — no separate kickoff
    // here, otherwise we'd send two ``automations/get_available``
    // calls per mount. The section-mount announcement (which lets
    // the page-level save guard hold a direct ref and call
    // flushPending() before its global save) is dispatched by the
    // shared engine's hostConnected.
  }

  protected override updated(changed: Map<string, unknown>) {
    super.updated(changed);
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

  protected async _loadAvailable() {
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
    const gate = this.renderStateGate();
    if (gate) return gate;
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
              focusFieldPath: entryFieldFocus(focus),
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
        focusTarget: actionsFocus(focus),
        descriptionKey: "device.automation_actions_description",
        onActionsChange: this._onActionsChange,
      })}
      ${this.renderFooter({
        label: this._localize("device.delete_automation"),
        message: () =>
          this._localize("device.confirm_delete_automation", {
            name: this._deleteTargetName(activeTrigger),
          }),
      })}
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

  // ─── Delete ──────────────────────────────────────────────────

  /** Identity for the delete prompt; before the trigger catalog
   *  resolves, the raw ``on_*`` key still names the automation
   *  where the header title would degrade to "Automation". */
  private _deleteTargetName(activeTrigger: AutomationTrigger | null): string {
    const location = this.location;
    if (
      !activeTrigger &&
      (location?.kind === "device_on" || location?.kind === "component_on")
    ) {
      return location.trigger;
    }
    return automationHeaderTitle(location, activeTrigger, this._localize);
  }

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
