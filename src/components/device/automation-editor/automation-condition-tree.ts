/**
 * Step 3 of the automation editor: optional "only run if" gate.
 *
 * Recursive — boolean combinator conditions (``and`` / ``or`` /
 * ``all`` / ``any`` / ``not`` / ``xor``) carry a child list of
 * conditions and render their own sub-tree. Leaf conditions
 * (``binary_sensor.is_on``, ``lambda``, ``for``, ...) render a
 * parameter form via ``<esphome-config-entry-form>``.
 *
 * Parent holds the ``ConditionNode[]``; this component emits
 * ``conditions-change`` with the new list on every mutation.
 */
import { consume } from "@lit/context";
import { html, LitElement, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import {
  mdiArrowDown,
  mdiArrowUp,
  mdiClose,
  mdiDelete,
  mdiPencilOutline,
  mdiPlus,
} from "@mdi/js";

import type {
  AutomationCondition,
  AvailableComponentInstance,
  BoardCatalogEntry,
  ConditionNode,
} from "../../../api/types.js";
import type { LocalizeFunc } from "../../../common/localize.js";
import { localizeContext } from "../../../context/index.js";
import { espHomeStyles } from "../../../styles/shared.js";
import { inputStyles } from "../../../styles/inputs.js";
import { renderMarkdown } from "../../../util/markdown.js";
import { registerMdiIcons } from "../../../util/register-icons.js";
import { automationEditorStyles } from "./automation-editor.styles.js";
import {
  applyParamChange,
  emptyConditionNode,
  removeAt,
  replaceAt,
  swap,
} from "./serialise.js";
import "../config-entry-form.js";
import type { ConfigEntryValueChange } from "../config-entry-form.js";
import "./catalog-picker-dialog.js";
import type {
  CatalogPickedDetail,
  ESPHomeCatalogPickerDialog,
} from "./catalog-picker-dialog.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({
  "arrow-down": mdiArrowDown,
  "arrow-up": mdiArrowUp,
  close: mdiClose,
  delete: mdiDelete,
  "pencil-outline": mdiPencilOutline,
  plus: mdiPlus,
});

@customElement("esphome-automation-condition-tree")
export class ESPHomeAutomationConditionTree extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  /** The list of conditions to render. */
  @property({ attribute: false })
  conditions: ConditionNode[] = [];

  /** Full conditions catalog — keyed by ``id``. */
  @property({ attribute: false })
  catalog: AutomationCondition[] = [];

  @property({ attribute: false })
  board: BoardCatalogEntry | null = null;

  @property() yaml = "";

  @property({ type: Boolean })
  disabled = false;

  /** Used by the recursive call from boolean combinators so the
   *  outer header (``Only run when``) only appears at the top
   *  level. */
  @property({ type: Boolean, attribute: "no-header" })
  noHeader = false;

  /** Configured component instances — forwarded into the catalog
   *  picker dialog so the user can scope by configured device when
   *  building a condition (e.g. ``binary_sensor.is_on`` for which
   *  configured binary_sensor). */
  @property({ attribute: false })
  devices: AvailableComponentInstance[] = [];

  @query("esphome-catalog-picker-dialog")
  private _picker!: ESPHomeCatalogPickerDialog;

  /**
   * Tracks which row the user is currently changing the kind of.
   * ``-1`` means "we're not changing an existing row — the picker
   * was opened from the bottom-of-list '+ Add condition' button".
   */
  @state() private _changingIdx = -1;

  static styles = [espHomeStyles, inputStyles, automationEditorStyles];

  protected render() {
    return html`
      <div class=${this.noHeader ? "" : "ae-section"}>
        ${this.noHeader
          ? nothing
          : html`<label class="ae-section-label"
              >${this._localize("device.automation_only_when")}</label
            >`}
        ${this.conditions.length === 0
          ? html`<p class="ae-empty">${this._localize("device.add_condition")}</p>`
          : this.conditions.map((node, idx) => this._renderNode(node, idx))}
        <button
          type="button"
          class="ae-add"
          ?disabled=${this.disabled || this.catalog.length === 0}
          @click=${this._openPickerForAdd}
        >
          <wa-icon library="mdi" name="plus"></wa-icon>
          ${this._localize("device.add_condition")}
        </button>
        <esphome-catalog-picker-dialog
          kind="condition"
          .items=${this.catalog}
          .devices=${this.devices}
          @catalog-picked=${this._onConditionPicked}
        ></esphome-catalog-picker-dialog>
      </div>
    `;
  }

  private _renderNode(node: ConditionNode, idx: number) {
    const def = this.catalog.find((c) => c.id === node.condition_id);
    const lastIdx = this.conditions.length - 1;
    return html`
      <div class="ae-row">
        <div class="ae-row-header">
          <button
            type="button"
            class="ae-row-picker"
            ?disabled=${this.disabled}
            @click=${() => this._openPickerForChange(idx)}
          >
            <span class="ae-row-picker-name"> ${def?.name ?? node.condition_id} </span>
            <wa-icon library="mdi" name="pencil-outline"></wa-icon>
          </button>
          <div class="ae-row-controls">
            <button
              type="button"
              ?disabled=${this.disabled || idx === 0}
              aria-label=${this._localize("device.automation_move_up")}
              @click=${() => this._move(idx, idx - 1)}
            >
              <wa-icon library="mdi" name="arrow-up"></wa-icon>
            </button>
            <button
              type="button"
              ?disabled=${this.disabled || idx === lastIdx}
              aria-label=${this._localize("device.automation_move_down")}
              @click=${() => this._move(idx, idx + 1)}
            >
              <wa-icon library="mdi" name="arrow-down"></wa-icon>
            </button>
            <button
              type="button"
              class="ae-row-delete"
              ?disabled=${this.disabled}
              aria-label=${this._localize("device.automation_remove")}
              @click=${() => this._remove(idx)}
            >
              <wa-icon library="mdi" name="delete"></wa-icon>
            </button>
          </div>
        </div>
        <div class="ae-row-body">
          ${def?.description
            ? html`<p class="ae-row-desc">${renderMarkdown(def.description)}</p>`
            : nothing}
          ${def && def.config_entries.length > 0
            ? html`<esphome-config-entry-form
                .entries=${def.config_entries}
                .values=${node.params}
                .board=${this.board}
                .yaml=${this.yaml}
                ?disabled=${this.disabled}
                @value-change=${(e: CustomEvent<ConfigEntryValueChange>) =>
                  this._onParamChange(idx, e)}
              ></esphome-config-entry-form>`
            : nothing}
          ${def?.accepts_condition_list
            ? html`<div class="ae-nested">
                <p class="ae-nested-label">
                  ${this._localize("device.automation_condition")}
                </p>
                <esphome-automation-condition-tree
                  no-header
                  .conditions=${node.children ?? []}
                  .catalog=${this.catalog}
                  .devices=${this.devices}
                  .board=${this.board}
                  .yaml=${this.yaml}
                  ?disabled=${this.disabled}
                  @conditions-change=${(
                    e: CustomEvent<{ conditions: ConditionNode[] }>
                  ) => this._onChildrenChange(idx, e)}
                ></esphome-automation-condition-tree>
              </div>`
            : nothing}
        </div>
      </div>
    `;
  }

  private _openPickerForAdd = () => {
    if (this.catalog.length === 0) return;
    this._changingIdx = -1;
    this._picker.open();
  };

  private _openPickerForChange(idx: number) {
    if (this.catalog.length === 0) return;
    this._changingIdx = idx;
    this._picker.open();
  }

  private _onConditionPicked = (e: CustomEvent<CatalogPickedDetail>) => {
    e.stopPropagation();
    // Switching condition kinds drops the old params — the new
    // condition's schema is different, so retaining values would
    // surface fields the renderer wouldn't paint and re-emit values
    // the writer wouldn't understand.
    const node: ConditionNode = emptyConditionNode(e.detail.id);
    if (e.detail.preFilledParams) {
      node.params = { ...node.params, ...e.detail.preFilledParams };
    }
    if (this._changingIdx >= 0) {
      this._emit(replaceAt(this.conditions, this._changingIdx, node));
    } else {
      this._emit([...this.conditions, node]);
    }
    this._changingIdx = -1;
  };

  private _onParamChange(idx: number, e: CustomEvent<ConfigEntryValueChange>) {
    e.stopPropagation();
    const old = this.conditions[idx];
    const params = applyParamChange(old.params, e.detail.path, e.detail.value);
    this._emit(replaceAt(this.conditions, idx, { ...old, params }));
  }

  private _onChildrenChange(
    idx: number,
    e: CustomEvent<{ conditions: ConditionNode[] }>
  ) {
    e.stopPropagation();
    const old = this.conditions[idx];
    this._emit(
      replaceAt(this.conditions, idx, { ...old, children: e.detail.conditions })
    );
  }

  private _move(from: number, to: number) {
    this._emit(swap(this.conditions, from, to));
  }

  private _remove(idx: number) {
    this._emit(removeAt(this.conditions, idx));
  }

  private _emit(conditions: ConditionNode[]) {
    this.dispatchEvent(
      new CustomEvent("conditions-change", {
        detail: { conditions },
        bubbles: true,
        composed: true,
      })
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-automation-condition-tree": ESPHomeAutomationConditionTree;
  }
}
