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
import {
  mdiArrowDown,
  mdiArrowUp,
  mdiChevronDown,
  mdiChevronUp,
  mdiClose,
  mdiDelete,
  mdiPencilOutline,
} from "@mdi/js";
import { html, LitElement, nothing, type PropertyValues } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";

import type {
  ActionNode,
  AutomationAction,
  AutomationCondition,
  AvailableComponentInstance,
  AvailableScript,
  ConditionNode,
} from "../../../api/types/automations.js";
import type { BoardCatalogEntry } from "../../../api/types/boards.js";
import type { LocalizeFunc } from "../../../common/localize.js";
import { localizeContext } from "../../../context/index.js";
import { inputStyles } from "../../../styles/inputs.js";
import { espHomeStyles } from "../../../styles/shared.js";
import { actionAdvancedState } from "../../../util/config-entry-tree.js";
import { renderMarkdown } from "../../../util/markdown.js";
import { registerMdiIcons } from "../../../util/register-icons.js";
import { renderAdvancedToggle } from "../advanced-toggle.js";
import "../config-entry-form.js";
import type { ConfigEntryValueChange } from "../config-entry-form.js";
import "../config-entry-renderers/lambda-editor.js";
import { lambdaBodyOf } from "../config-entry-renderers/lambda.js";
import { literalLambdaToggleStyles } from "../config-entry-renderers/literal-lambda-toggle.js";
import "./automation-condition-tree.js";
import {
  delayLambdaOf,
  type DelayUnit,
  readDelay,
  renderDelayParams,
  writeDelayLambdaParams,
  writeDelayParams,
} from "./automation-delay-params.js";
import { automationEditorStyles } from "./automation-editor.styles.js";
import "./catalog-picker-dialog.js";
import type {
  CatalogPickedDetail,
  ESPHomeCatalogPickerDialog,
} from "./catalog-picker-dialog.js";
import { applyParamChange } from "./serialise.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/option/option.js";
import "@home-assistant/webawesome/dist/components/select/select.js";

registerMdiIcons({
  "arrow-down": mdiArrowDown,
  "arrow-up": mdiArrowUp,
  "chevron-down": mdiChevronDown,
  "chevron-up": mdiChevronUp,
  close: mdiClose,
  delete: mdiDelete,
  "pencil-outline": mdiPencilOutline,
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

  /** Configured component instances — forwarded into the catalog
   *  picker dialog's "By target" tab. */
  @property({ attribute: false })
  devices: AvailableComponentInstance[] = [];

  @property({ attribute: false })
  board: BoardCatalogEntry | null = null;

  @property() yaml = "";

  @property({ type: Boolean })
  disabled = false;

  @property({ type: Boolean })
  first = false;

  @property({ type: Boolean })
  last = false;

  @query("esphome-catalog-picker-dialog")
  private _picker!: ESPHomeCatalogPickerDialog;

  /**
   * Collapsed = compact one-line view (just the picker / action
   * name + the controls strip). Expanded = full body with the
   * description, the params form, the condition gate, and any
   * nested action lists. Default expanded so a freshly-picked
   * action shows its fields without an extra click; the user can
   * collapse cards manually once a chain gets long.
   */
  @state() private _collapsed = false;

  /** "Show advanced settings" gate for the action params form. */
  @state() private _showAdvanced = false;

  /** Stashed other-side values for the Delay literal/lambda toggle, so
   *  flipping back and forth doesn't discard the user's work before they
   *  return to it: the C++ body for the lambda side, the value + unit for
   *  the literal side. Both reset when the action kind changes. */
  @state() private _delayLambdaStash = "";
  @state() private _delayLiteralStash: { value: string; unit: DelayUnit } | null = null;

  static styles = [
    espHomeStyles,
    inputStyles,
    automationEditorStyles,
    literalLambdaToggleStyles,
  ];

  /**
   * The list reuses nodes by DOM position (plain actions.map, no keyed
   * repeat), so a reorder/delete only rebinds .value and the @state
   * view-flags would otherwise leak onto whichever action lands here.
   * Key the reset off action_id, not object identity: a same-action
   * param edit re-emits a fresh ActionNode every keystroke and resetting
   * on that would snap the card shut mid-edit.
   */
  protected willUpdate(changed: PropertyValues<this>): void {
    if (!changed.has("value")) return;
    const previous = changed.get("value") as ActionNode | undefined;
    if (previous && previous.action_id !== this.value.action_id) {
      this._collapsed = false;
      this._showAdvanced = false;
      this._delayLambdaStash = "";
      this._delayLiteralStash = null;
    }
  }

  protected render() {
    const def = this.catalog.find((a) => a.id === this.value.action_id);
    const collapsed = this._collapsed;
    return html`
      <div class="ae-row ${collapsed ? "ae-row--collapsed" : ""}">
        <div class="ae-row-header">
          <button
            type="button"
            class="ae-row-picker"
            ?disabled=${this.disabled}
            title=${this._localize("device.automation_action_pick")}
            @click=${this._openPicker}
          >
            <span class="ae-row-picker-name"> ${def?.name ?? this.value.action_id} </span>
            <wa-icon library="mdi" name="pencil-outline"></wa-icon>
          </button>
          <div class="ae-row-controls">
            <button
              type="button"
              aria-label=${collapsed
                ? this._localize("device.automation_action_expand")
                : this._localize("device.automation_action_collapse")}
              aria-expanded=${collapsed ? "false" : "true"}
              @click=${() => {
                this._collapsed = !this._collapsed;
              }}
            >
              <wa-icon
                library="mdi"
                name=${collapsed ? "chevron-down" : "chevron-up"}
              ></wa-icon>
            </button>
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
              class="ae-row-delete"
              ?disabled=${this.disabled}
              aria-label=${this._localize("device.automation_remove")}
              @click=${this._onDelete}
            >
              <wa-icon library="mdi" name="delete"></wa-icon>
            </button>
          </div>
        </div>
        <esphome-catalog-picker-dialog
          kind="action"
          .items=${this.catalog}
          .devices=${this.devices}
          @catalog-picked=${this._onActionPicked}
        ></esphome-catalog-picker-dialog>
        ${collapsed
          ? nothing
          : html`<div class="ae-row-body">
              ${def?.description
                ? html`<p class="ae-row-desc">${renderMarkdown(def.description)}</p>`
                : nothing}
              ${this._renderActionParams(def)} ${this._renderScriptParams(def)}
              ${this._renderConditionGate(def)} ${this._renderNestedLists(def)}
            </div>`}
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
        (p) =>
          html`<label class="ae-section-label" for="script-${p.name}"
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
            />`
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
      <p class="ae-nested-label">${this._localize("device.automation_only_when")}</p>
      <esphome-automation-condition-tree
        no-header
        .conditions=${this.value.conditions ?? []}
        .catalog=${this.conditionCatalog}
        .devices=${this.devices}
        .board=${this.board}
        .yaml=${this.yaml}
        ?disabled=${this.disabled}
        @conditions-change=${this._onConditionsChange}
      ></esphome-automation-condition-tree>
    </div>`;
  }

  /** Label a nested action list: ``then`` / ``else`` keep their
   *  control-flow wording, other keys title-case so each is distinct. */
  private _nestedListLabel(key: string): string {
    if (key === "else") return this._localize("device.automation_else");
    if (key === "then") return this._localize("device.automation_action");
    // Backend-driven trigger keys have no fixed localization key;
    // title-case for now (English only).
    return key
      .split("_")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
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
      (key) =>
        html`<div class="ae-nested">
          <p class="ae-nested-label">${this._nestedListLabel(key)}</p>
          <esphome-automation-action-list
            no-header
            .actions=${this.value.children?.[key] ?? []}
            .catalog=${this.catalog}
            .conditionCatalog=${this.conditionCatalog}
            .scripts=${this.scripts}
            .devices=${this.devices}
            .board=${this.board}
            .yaml=${this.yaml}
            ?disabled=${this.disabled}
            @actions-change=${(e: CustomEvent<{ actions: ActionNode[] }>) => {
              // The nested list dispatches ``actions-change`` to mean
              // "my list of actions changed". This action-node folds
              // that into its own ``children[key]`` slot and re-emits
              // as ``action-change`` (the event our PARENT list
              // listens to). Without ``stopPropagation`` here the
              // bubbling ``actions-change`` would ALSO be caught by
              // the outer action-list — which would replace the
              // entire ``if`` node's slot with the nested list. Net
              // effect: adding a delay inside an if's then-branch
              // wipes the if and leaves just the delay.
              e.stopPropagation();
              this._onChildrenChange(key, e.detail.actions);
            }}
          ></esphome-automation-action-list>
        </div>`
    );
  }

  /**
   * Render the action's parameter form. Most actions go through
   * the catalog-driven ``<esphome-config-entry-form>``; specific
   * "shortcut" actions (currently: ``delay``) need a bespoke
   * surface because their catalog shape doesn't match the
   * one-knob user-facing UX. See ``_renderDelayParams`` for the
   * exact substitution.
   */
  private _renderActionParams(def: AutomationAction | undefined) {
    if (!def) return nothing;
    if (def.id === "delay") return this._renderDelayParams();
    if (def.config_entries.length === 0) return nothing;
    const { showAdvanced, showToggle } = actionAdvancedState(
      def.config_entries,
      this._showAdvanced
    );
    return html`<esphome-config-entry-form
        .entries=${def.config_entries}
        .values=${this.value.params}
        .board=${this.board}
        .yaml=${this.yaml}
        ?disabled=${this.disabled}
        ?show-advanced=${showAdvanced}
        @value-change=${this._onParamChange}
      ></esphome-config-entry-form>
      ${showToggle
        ? renderAdvancedToggle(this._showAdvanced, this._localize, (show) => {
            this._showAdvanced = show;
          })
        : nothing}`;
  }

  /** The bespoke value+unit / lambda Delay widget. The renderer and
   *  its params read/write helpers live in ``automation-delay-params``;
   *  the host owns only the toggle stashes and the emit plumbing. */
  private _renderDelayParams() {
    return renderDelayParams({
      params: this.value.params ?? {},
      disabled: this.disabled,
      localize: this._localize,
      onWrite: (value, unit) => this._writeDelay(value, unit),
      onWriteLambda: (body) => this._writeDelayLambda(body),
      onToggle: (toLambda) => this._toggleDelayLambda(toLambda),
    });
  }

  /** Flip the Delay action between its literal (value + unit) and
   *  ``!lambda`` forms, stashing the side being left so an accidental
   *  toggle doesn't discard the user's work before they flip back. */
  private _toggleDelayLambda(toLambda: boolean) {
    const params = this.value.params ?? {};
    const lambda = delayLambdaOf(params);
    if (toLambda === (lambda !== null)) return;
    if (toLambda) {
      this._delayLiteralStash = readDelay(params);
      this._writeDelayLambda(this._delayLambdaStash);
    } else {
      this._delayLambdaStash = lambdaBodyOf(lambda);
      const { value, unit } = this._delayLiteralStash ?? { value: "", unit: "s" };
      this._writeDelay(value, unit);
    }
  }

  /** Write a (numeric value, unit) pair into the delay action's params,
   *  using the canonical ``<unit>: <value>`` form. */
  private _writeDelay(value: string, unit: DelayUnit) {
    this._emit({
      ...this.value,
      params: writeDelayParams(this.value.params ?? {}, value, unit),
    });
  }

  /** Write a ``!lambda`` body into the delay action's scalar ``id``
   *  slot. The explicit ``!lambda`` tag is what makes the backend
   *  re-emit a lambda rather than a string literal. */
  private _writeDelayLambda(body: string) {
    this._delayLambdaStash = body;
    this._emit({
      ...this.value,
      params: writeDelayLambdaParams(this.value.params ?? {}, body),
    });
  }

  private _openPicker = () => {
    this._picker.open();
  };

  private _onActionPicked = (e: CustomEvent<CatalogPickedDetail>) => {
    e.stopPropagation();
    // Switching kinds drops params / nested children — different
    // schemas, parallel state would surface fields the renderer
    // wouldn't paint. Pre-filled params from the "By target" tab
    // are seeded on top of the reset.
    this._emit({
      action_id: e.detail.id,
      params: { ...(e.detail.preFilledParams ?? {}) },
      children: {},
      conditions: [],
    });
  };

  private _onParamChange = (e: CustomEvent<ConfigEntryValueChange>) => {
    e.stopPropagation();
    const params = applyParamChange(this.value.params, e.detail.path, e.detail.value);
    this._emit({ ...this.value, params });
  };

  private _patchParams(patch: Record<string, unknown>) {
    this._emit({ ...this.value, params: { ...this.value.params, ...patch } });
  }

  private _onConditionsChange = (e: CustomEvent<{ conditions: ConditionNode[] }>) => {
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
      })
    );
  }

  private _onDelete = () => {
    this.dispatchEvent(
      new CustomEvent("action-delete", {
        bubbles: true,
        composed: true,
      })
    );
  };

  private _emit(value: ActionNode) {
    this.dispatchEvent(
      new CustomEvent("action-change", {
        detail: { value },
        bubbles: true,
        composed: true,
      })
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-automation-action-node": ESPHomeAutomationActionNode;
  }
}
