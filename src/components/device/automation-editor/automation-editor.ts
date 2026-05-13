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
import { mdiContentSave, mdiDelete } from "@mdi/js";

import type { ESPHomeAPI } from "../../../api/index.js";
import type {
  AutomationAction,
  AutomationCondition,
  AutomationLocation,
  AutomationTree,
  AutomationTrigger,
  AvailableAutomations,
  AvailableComponentInstance,
  AvailableScript,
  BoardCatalogEntry,
  LightEffect,
  YamlDiff,
} from "../../../api/types.js";
import type { LocalizeFunc } from "../../../common/localize.js";
import { apiContext, localizeContext } from "../../../context/index.js";
import { espHomeStyles } from "../../../styles/shared.js";
import { inputStyles } from "../../../styles/inputs.js";
import { registerMdiIcons } from "../../../util/register-icons.js";
import {
  fetchAutomationActions,
  fetchAutomationConditions,
  fetchAutomationTriggers,
  fetchLightEffects,
} from "../../../util/automation-catalog-cache.js";
import { automationEditorStyles } from "./automation-editor.styles.js";
import { emptyAutomationTree } from "./serialise.js";
import "./automation-target-picker.js";
import "./automation-trigger-picker.js";
import "./automation-condition-tree.js";
import "./automation-action-list.js";
import "./automation-effects-editor.js";
import "./automation-script-params.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/spinner/spinner.js";

registerMdiIcons({
  "content-save": mdiContentSave,
  delete: mdiDelete,
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

  @property() yaml = "";

  @state() private _triggers: AutomationTrigger[] = [];
  @state() private _actions: AutomationAction[] = [];
  @state() private _conditions: AutomationCondition[] = [];
  @state() private _effects: LightEffect[] = [];
  @state() private _available: AvailableAutomations | null = null;

  @state() private _loading = true;
  @state() private _saving = false;
  @state() private _deleting = false;
  @state() private _error = "";

  /** In-flight write guard — parents that re-fetch on reconnect
   *  should consult this to skip clobbering an optimistic update. */
  public get inFlightWrite(): boolean {
    return this._saving || this._deleting;
  }

  static styles = [espHomeStyles, inputStyles, automationEditorStyles];

  connectedCallback(): void {
    super.connectedCallback();
    void this._loadCatalogs();
  }

  protected updated(changed: Map<string, unknown>) {
    if (changed.has("configuration")) {
      void this._loadAvailable();
    }
  }

  private async _loadCatalogs() {
    if (!this._api) return;
    this._loading = true;
    this._error = "";
    try {
      const [triggers, actions, conditions, effects] = await Promise.all([
        fetchAutomationTriggers(this._api, this.platform),
        fetchAutomationActions(this._api, this.platform),
        fetchAutomationConditions(this._api, this.platform),
        fetchLightEffects(this._api, this.platform),
      ]);
      this._triggers = triggers;
      this._actions = actions;
      this._conditions = conditions;
      this._effects = effects;
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
    const isLightEffect = target?.kind === "light_effect";
    const isScript = target?.kind === "script";
    const disabled = this._saving || this._deleting;
    return html`
      <esphome-automation-target-picker
        .value=${target}
        .devices=${devices}
        .scripts=${scripts}
        ?disabled=${disabled}
        @target-change=${this._onTargetChange}
      ></esphome-automation-target-picker>

      ${isLightEffect
        ? html`<esphome-automation-effects-editor
            .target=${target}
            .effects=${this._effects}
            .devices=${devices}
            .effectId=${automation.trigger_id}
            .effectParams=${automation.trigger_params}
            .board=${this.board}
            .yaml=${this.yaml}
            ?disabled=${disabled}
            @effect-change=${this._onEffectChange}
            @effect-params-change=${this._onEffectParamsChange}
          ></esphome-automation-effects-editor>`
        : nothing}

      ${isScript
        ? html`<esphome-automation-script-params
            .target=${target}
            .triggerParams=${automation.trigger_params}
            ?disabled=${disabled}
            @script-params-change=${this._onScriptParamsChange}
          ></esphome-automation-script-params>`
        : nothing}

      ${!isLightEffect && !isScript
        ? html`<esphome-automation-trigger-picker
            .target=${target}
            .triggers=${this._triggers}
            .devices=${devices}
            .triggerId=${automation.trigger_id}
            .triggerParams=${automation.trigger_params}
            .board=${this.board}
            .yaml=${this.yaml}
            ?disabled=${disabled}
            @trigger-change=${this._onTriggerChange}
            @trigger-params-change=${this._onTriggerParamsChange}
          ></esphome-automation-trigger-picker>`
        : nothing}

      ${!isLightEffect
        ? html`<esphome-automation-condition-tree
            .conditions=${automation.conditions}
            .catalog=${this._conditions}
            .board=${this.board}
            .yaml=${this.yaml}
            ?disabled=${disabled}
            @conditions-change=${this._onConditionsChange}
          ></esphome-automation-condition-tree>`
        : nothing}

      ${!isLightEffect
        ? html`<esphome-automation-action-list
            .actions=${automation.actions}
            .catalog=${this._actions}
            .conditionCatalog=${this._conditions}
            .scripts=${scripts}
            .board=${this.board}
            .yaml=${this.yaml}
            ?disabled=${disabled}
            @actions-change=${this._onActionsChange}
          ></esphome-automation-action-list>`
        : nothing}

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
            : this._localize("device.add_automation")}
        </button>
        ${this.location && this.value
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
  };

  private _onTriggerParamsChange = (
    e: CustomEvent<{ params: Record<string, unknown> }>,
  ) => {
    e.stopPropagation();
    this._withValue({ trigger_params: e.detail.params });
  };

  private _onConditionsChange = (
    e: CustomEvent<{ conditions: AutomationTree["conditions"] }>,
  ) => {
    e.stopPropagation();
    this._withValue({ conditions: e.detail.conditions });
  };

  private _onActionsChange = (
    e: CustomEvent<{ actions: AutomationTree["actions"] }>,
  ) => {
    e.stopPropagation();
    this._withValue({ actions: e.detail.actions });
  };

  private _onEffectChange = (
    e: CustomEvent<{ effectId: string; params: Record<string, unknown> }>,
  ) => {
    e.stopPropagation();
    // For light effects we abuse trigger_id/trigger_params as the
    // effect-id / effect-params storage. The writer translates this
    // back into a regular ``effects:`` list item on save.
    this._withValue({
      trigger_id: e.detail.effectId,
      trigger_params: e.detail.params,
    });
  };

  private _onEffectParamsChange = (
    e: CustomEvent<{ params: Record<string, unknown> }>,
  ) => {
    e.stopPropagation();
    this._withValue({ trigger_params: e.detail.params });
  };

  private _onScriptParamsChange = (
    e: CustomEvent<{ triggerParams: Record<string, unknown> }>,
  ) => {
    e.stopPropagation();
    this._withValue({ trigger_params: e.detail.triggerParams });
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
