/**
 * Renders one action row inside an action list — the action's
 * picker, its parameter form, and (for control-flow actions) its
 * nested condition gate + nested action lists.
 *
 * Recursion lives in ``<esphome-automation-action-list>`` (children
 * keyed by ``accepts_action_list``) and
 * ``<esphome-automation-condition-tree>`` (the boolean gate).
 *
 * Pure-presentational: parent owns the ``ActionNode`` and the
 * change events bubble up; we re-emit a fresh ``ActionNode`` on
 * every mutation.
 */
import { consume } from "@lit/context";
import { html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { mdiArrowDown, mdiArrowUp, mdiClose } from "@mdi/js";

import type {
  ActionNode,
  AutomationAction,
  AutomationCondition,
  AvailableScript,
  BoardCatalogEntry,
  ConditionNode,
} from "../../../api/types.js";
import type { LocalizeFunc } from "../../../common/localize.js";
import { localizeContext } from "../../../context/index.js";
import { espHomeStyles } from "../../../styles/shared.js";
import { inputStyles } from "../../../styles/inputs.js";
import { registerMdiIcons } from "../../../util/register-icons.js";
import { automationEditorStyles } from "./automation-editor.styles.js";
import { applyParamChange } from "./serialise.js";
import "../config-entry-form.js";
import type { ConfigEntryValueChange } from "../config-entry-form.js";
import "./automation-condition-tree.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/option/option.js";
import "@home-assistant/webawesome/dist/components/select/select.js";

registerMdiIcons({
  "arrow-down": mdiArrowDown,
  "arrow-up": mdiArrowUp,
  close: mdiClose,
});

@customElement("esphome-automation-action-node")
export class ESPHomeAutomationActionNode extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @property({ attribute: false })
  value!: ActionNode;

  /** Action catalog — keyed by ``id``. */
  @property({ attribute: false })
  catalog: AutomationAction[] = [];

  /** Condition catalog forwarded into the boolean-gate tree for
   *  control-flow actions that accept conditions. */
  @property({ attribute: false })
  conditionCatalog: AutomationCondition[] = [];

  /** Declared scripts — used by ``script.execute`` to render the
   *  picked script's parameters dynamically. */
  @property({ attribute: false })
  scripts: AvailableScript[] = [];

  @property({ attribute: false })
  board: BoardCatalogEntry | null = null;

  @property() yaml = "";

  @property({ type: Boolean })
  disabled = false;

  @property({ type: Boolean })
  first = false;

  @property({ type: Boolean })
  last = false;

  static styles = [espHomeStyles, inputStyles, automationEditorStyles];

  protected render() {
    const def = this.catalog.find((a) => a.id === this.value.action_id);
    return html`
      <div class="ae-row">
        <div class="ae-row-body">
          <wa-select
            ?disabled=${this.disabled}
            @change=${this._onActionChange}
          >
            ${this.catalog.map(
              (a) => html`<wa-option
                value=${a.id}
                ?selected=${a.id === this.value.action_id}
                >${a.name}</wa-option
              >`,
            )}
          </wa-select>
          ${def?.description
            ? html`<p class="ae-section-desc">${def.description}</p>`
            : nothing}
          ${def && def.config_entries.length > 0
            ? html`<esphome-config-entry-form
                .entries=${def.config_entries}
                .values=${this.value.params}
                .board=${this.board}
                .yaml=${this.yaml}
                ?disabled=${this.disabled}
                @value-change=${this._onParamChange}
              ></esphome-config-entry-form>`
            : nothing}
          ${this._renderScriptParams(def)}
          ${this._renderConditionGate(def)}
          ${this._renderNestedLists(def)}
        </div>
        <div class="ae-row-controls">
          <button
            type="button"
            ?disabled=${this.disabled || this.first}
            aria-label=${this._localize("device.automation_move_up")}
            @click=${() => this._reorder(-1)}
          >
            <wa-icon library="mdi" name="arrow-up"></wa-icon>
          </button>
          <button
            type="button"
            ?disabled=${this.disabled || this.last}
            aria-label=${this._localize("device.automation_move_down")}
            @click=${() => this._reorder(+1)}
          >
            <wa-icon library="mdi" name="arrow-down"></wa-icon>
          </button>
          <button
            type="button"
            ?disabled=${this.disabled}
            aria-label=${this._localize("device.automation_remove")}
            @click=${this._onDelete}
          >
            <wa-icon library="mdi" name="close"></wa-icon>
          </button>
        </div>
      </div>
    `;
  }

  /**
   * ``script.execute`` — render a dynamic parameter form derived
   * from the picked script's declared ``parameters:``. The catalog
   * doesn't carry these because they're per-device state.
   */
  private _renderScriptParams(def: AutomationAction | undefined) {
    if (def?.id !== "script.execute") return nothing;
    const id = String(this.value.params.id ?? "");
    const script = this.scripts.find((s) => s.id === id);
    if (!script || script.parameters.length === 0) return nothing;
    return html`<div class="ae-nested">
      <p class="ae-nested-label">
        ${this._localize("device.automation_script_parameters")}
      </p>
      ${script.parameters.map(
        (p) => html`<label class="ae-section-label" for="script-${p.name}"
            >${p.name} <span class="ae-muted">${p.type}</span></label
          >
          <input
            id="script-${p.name}"
            type=${p.type === "int" || p.type === "float" ? "number" : "text"}
            ?disabled=${this.disabled}
            .value=${String(this.value.params[p.name] ?? "")}
            @input=${(e: Event) => {
              const raw = (e.target as HTMLInputElement).value;
              const next =
                p.type === "int"
                  ? raw === ""
                    ? ""
                    : parseInt(raw, 10)
                  : p.type === "float"
                    ? raw === ""
                      ? ""
                      : Number(raw)
                    : raw;
              this._patchParams({ [p.name]: next });
            }}
          />`,
      )}
    </div>`;
  }

  /**
   * Render the boolean-gate condition tree for actions that
   * declare one (``if`` / ``wait_until``).
   */
  private _renderConditionGate(def: AutomationAction | undefined) {
    // Only ``if`` and ``wait_until`` carry a separate boolean-gate
    // condition list distinct from a sub-action list. Detect by
    // checking the catalog's action id rather than re-introducing
    // a flag on AutomationAction — the wire shape keeps the gate
    // implicit in the action's semantics.
    if (!def) return nothing;
    if (def.id !== "if" && def.id !== "wait_until") return nothing;
    return html`<div class="ae-nested">
      <p class="ae-nested-label">
        ${this._localize("device.automation_only_when")}
      </p>
      <esphome-automation-condition-tree
        no-header
        .conditions=${this.value.conditions ?? []}
        .catalog=${this.conditionCatalog}
        .board=${this.board}
        .yaml=${this.yaml}
        ?disabled=${this.disabled}
        @conditions-change=${this._onConditionsChange}
      ></esphome-automation-condition-tree>
    </div>`;
  }

  /**
   * Render one nested action list per entry in
   * ``def.accepts_action_list``. ``"then"`` / ``"else"`` for
   * ``if``, ``"then"`` for ``while`` / ``repeat`` / ``wait_until``.
   *
   * The list itself is ``<esphome-automation-action-list>`` —
   * defined in a sibling file so we can route through this node
   * recursively without circular imports.
   */
  private _renderNestedLists(def: AutomationAction | undefined) {
    if (!def || !def.accepts_action_list || def.accepts_action_list.length === 0) {
      return nothing;
    }
    return def.accepts_action_list.map(
      (key) => html`<div class="ae-nested">
        <p class="ae-nested-label">
          ${key === "else"
            ? this._localize("device.automation_else")
            : this._localize("device.automation_action")}
        </p>
        <esphome-automation-action-list
          no-header
          .actions=${this.value.children?.[key] ?? []}
          .catalog=${this.catalog}
          .conditionCatalog=${this.conditionCatalog}
          .scripts=${this.scripts}
          .board=${this.board}
          .yaml=${this.yaml}
          ?disabled=${this.disabled}
          @actions-change=${(e: CustomEvent<{ actions: ActionNode[] }>) =>
            this._onChildrenChange(key, e.detail.actions)}
        ></esphome-automation-action-list>
      </div>`,
    );
  }

  private _onActionChange = (e: Event) => {
    const newId = (e.target as HTMLSelectElement).value;
    // Switching kinds drops params / nested children — different
    // schemas, parallel state would surface fields the renderer
    // wouldn't paint.
    this._emit({
      action_id: newId,
      params: {},
      children: {},
      conditions: [],
    });
  };

  private _onParamChange = (e: CustomEvent<ConfigEntryValueChange>) => {
    e.stopPropagation();
    const params = applyParamChange(
      this.value.params,
      e.detail.path,
      e.detail.value,
    );
    this._emit({ ...this.value, params });
  };

  private _patchParams(patch: Record<string, unknown>) {
    this._emit({ ...this.value, params: { ...this.value.params, ...patch } });
  }

  private _onConditionsChange = (
    e: CustomEvent<{ conditions: ConditionNode[] }>,
  ) => {
    e.stopPropagation();
    this._emit({ ...this.value, conditions: e.detail.conditions });
  };

  private _onChildrenChange(key: string, actions: ActionNode[]) {
    const children = { ...(this.value.children ?? {}), [key]: actions };
    this._emit({ ...this.value, children });
  }

  private _reorder(delta: number) {
    this.dispatchEvent(
      new CustomEvent("action-reorder", {
        detail: { delta },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _onDelete = () => {
    this.dispatchEvent(
      new CustomEvent("action-delete", {
        bubbles: true,
        composed: true,
      }),
    );
  };

  private _emit(value: ActionNode) {
    this.dispatchEvent(
      new CustomEvent("action-change", {
        detail: { value },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-automation-action-node": ESPHomeAutomationActionNode;
  }
}
