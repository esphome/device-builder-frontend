/**
 * Step 4 of the automation editor: the ordered action list.
 *
 * Recursive — control-flow actions (``if`` / ``while`` / ``repeat`` /
 * ``wait_until``) embed nested action lists for each of their
 * ``accepts_action_list`` keys. Each action row is an
 * ``<esphome-automation-action-node>``; this component owns the
 * outer list ergonomics (add / reorder / remove). Rows are keyed, so
 * per-row state follows its action.
 *
 * Pure-presentational: parent owns ``actions`` and listens for
 * ``actions-change`` to update its own state.
 */
import { consume } from "@lit/context";
import { mdiPlus } from "@mdi/js";
import { html, LitElement, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";

import type {
  ActionNode,
  AutomationAction,
  AutomationCondition,
  AvailableComponentInstance,
  AvailableScript,
} from "../../../api/types/automations.js";
import type { BoardCatalogEntry } from "../../../api/types/boards.js";
import type { LocalizeFunc } from "../../../common/localize.js";
import { localizeContext } from "../../../context/index.js";
import { inputStyles } from "../../../styles/inputs.js";
import { espHomeStyles } from "../../../styles/shared.js";
import { fireEvent } from "../../../util/fire-event.js";
import { registerMdiIcons } from "../../../util/register-icons.js";
import "./automation-action-node.js";
import { automationEditorStyles } from "./automation-editor.styles.js";
import {
  type AutomationFocus,
  childFocus,
  focusTargetHasChanged,
} from "./automation-focus.js";
import type { CatalogPickedDetail } from "./catalog-picker-dialog.js";
import { requestCatalogPick } from "./catalog-picker-host.js";
import { RowKeys } from "./row-keys.js";
import { emptyActionNode, removeAt, replaceAt, swap } from "./serialise.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({ plus: mdiPlus });

@customElement("esphome-automation-action-list")
export class ESPHomeAutomationActionList extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @property({ attribute: false })
  actions: ActionNode[] = [];

  @property({ attribute: false })
  catalog: AutomationAction[] = [];

  @property({ attribute: false })
  conditionCatalog: AutomationCondition[] = [];

  @property({ attribute: false })
  scripts: AvailableScript[] = [];

  /** Configured component instances — forwarded to the picker
   *  dialog for its "By target" tab. */
  @property({ attribute: false })
  devices: AvailableComponentInstance[] = [];

  @property({ attribute: false })
  board: BoardCatalogEntry | null = null;

  @property() yaml = "";

  @property({ type: Boolean })
  disabled = false;

  /** Suppress the outer "Actions" header when this list is rendered
   *  as a nested child (``then:`` / ``else:`` under a control-flow
   *  action). The parent action-node already labels the slot. */
  @property({ type: Boolean, attribute: "no-header" })
  noHeader = false;

  /** Cursor focus target whose ``node`` head indexes this list; the
   *  matching row gets the sliced remainder. */
  @property({ attribute: false, hasChanged: focusTargetHasChanged })
  focusTarget: AutomationFocus | null = null;

  static styles = [espHomeStyles, inputStyles, automationEditorStyles];

  private readonly _rows = new RowKeys<ActionNode>();

  /** The control that asked for a reorder. Its row is moved in the DOM,
   *  which drops focus, so it is focused again once the rows have moved.
   *  The owner can drop the reorder, and then nothing is focused. */
  private _refocus: HTMLElement | null = null;

  /** Key of the row the caret's target was handed to. A target names its
   *  row by index, so a row that a reorder or a delete brings to that
   *  index would otherwise take it over, and flash and expand as if the
   *  caret had moved there. */
  private _focusRow: number | undefined;

  protected willUpdate(changed: PropertyValues<this>): void {
    if (!changed.has("focusTarget")) return;
    const at = this.focusTarget?.node[0];
    this._focusRow =
      typeof at === "number" ? this._rows.keysFor(this.actions)[at] : undefined;
  }

  protected updated(changed: PropertyValues<this>): void {
    if (changed.has("actions")) this._refocus?.focus();
    this._refocus = null;
  }

  protected render() {
    const keys = this._rows.keysFor(this.actions);
    return html`
      <div class=${this.noHeader ? "" : "ae-section"}>
        ${
          this.noHeader
            ? nothing
            : html`<label class="ae-section-label"
                >${this._localize("device.automation_action")}</label
              >`
        }
        ${
          this.actions.length === 0
            ? html`<p class="empty-message--dashed" role="status">
                ${this._localize("device.automation_actions_empty")}
              </p>`
            : repeat(
                this.actions,
                (_node, idx) => keys[idx],
                (node, idx) => this._renderRow(node, idx, keys[idx])
              )
        }
        <button
          type="button"
          class="ae-add"
          ?disabled=${this.disabled || this.catalog.length === 0}
          @click=${this._openPicker}
        >
          <wa-icon library="mdi" name="plus"></wa-icon>
          ${this._localize("device.add_action")}
        </button>
      </div>
    `;
  }

  private _openPicker = () => {
    if (this.catalog.length === 0) return;
    requestCatalogPick(this, {
      kind: "action",
      items: this.catalog,
      devices: this.devices,
      onPicked: this._onActionPicked,
    });
  };

  private _renderRow(node: ActionNode, idx: number, key: number) {
    const focus = this.focusTarget;
    const isLast = idx === this.actions.length - 1;
    return html`<esphome-automation-action-node
      .value=${node}
      .focusTarget=${
        focus?.node[0] === idx && key === this._focusRow ? childFocus(focus) : null
      }
      .catalog=${this.catalog}
      .conditionCatalog=${this.conditionCatalog}
      .scripts=${this.scripts}
      .devices=${this.devices}
      .board=${this.board}
      .yaml=${this.yaml}
      ?disabled=${this.disabled}
      ?first=${idx === 0}
      ?last=${isLast}
      @action-change=${(e: CustomEvent<{ value: ActionNode }>) =>
        this._onActionChange(idx, e)}
      @action-reorder=${(e: CustomEvent<{ delta: number }>) => this._onReorder(idx, e)}
      @action-delete=${(e: Event) => this._onDelete(idx, e)}
    ></esphome-automation-action-node>`;
  }

  private _onActionPicked = (detail: CatalogPickedDetail) => {
    const node = emptyActionNode(detail.id);
    if (detail.preFilledParams) {
      node.params = { ...node.params, ...detail.preFilledParams };
    }
    this._emit([...this.actions, node]);
  };

  private _onActionChange(idx: number, e: CustomEvent<{ value: ActionNode }>) {
    e.stopPropagation();
    this._emit(replaceAt(this.actions, idx, e.detail.value));
  }

  private _onReorder(idx: number, e: CustomEvent<{ delta: number }>) {
    e.stopPropagation();
    const row = e.currentTarget as HTMLElement;
    this._refocus = row.shadowRoot?.activeElement as HTMLElement | null;
    this._emit(swap(this.actions, idx, idx + e.detail.delta));
  }

  private _onDelete(idx: number, e: Event) {
    e.stopPropagation();
    this._emit(removeAt(this.actions, idx));
  }

  private _emit(actions: ActionNode[]) {
    fireEvent(this, "actions-change", { actions });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-automation-action-list": ESPHomeAutomationActionList;
  }
}
