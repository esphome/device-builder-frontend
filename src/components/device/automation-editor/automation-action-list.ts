/**
 * Step 4 of the automation editor: the ordered action list.
 *
 * Recursive — control-flow actions (``if`` / ``while`` / ``repeat`` /
 * ``wait_until``) embed nested action lists for each of their
 * ``accepts_action_list`` keys. Each action row is an
 * ``<esphome-automation-action-node>``; this component owns the
 * outer list ergonomics (add / reorder / remove).
 *
 * Pure-presentational: parent owns ``actions`` and listens for
 * ``actions-change`` to update its own state.
 */
import { consume } from "@lit/context";
import { mdiPlus } from "@mdi/js";
import { html, LitElement, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";

import type {
  ActionNode,
  AutomationAction,
  AutomationCondition,
  AvailableComponentInstance,
  AvailableScript,
  BoardCatalogEntry,
} from "../../../api/types.js";
import type { LocalizeFunc } from "../../../common/localize.js";
import { localizeContext } from "../../../context/index.js";
import { inputStyles } from "../../../styles/inputs.js";
import { espHomeStyles } from "../../../styles/shared.js";
import { registerMdiIcons } from "../../../util/register-icons.js";
import "./automation-action-node.js";
import { automationEditorStyles } from "./automation-editor.styles.js";
import "./catalog-picker-dialog.js";
import type {
  CatalogPickedDetail,
  ESPHomeCatalogPickerDialog,
} from "./catalog-picker-dialog.js";
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

  @property({ type: Boolean, attribute: "hide-add" })
  hideAdd = false;

  @query("esphome-catalog-picker-dialog")
  private _picker!: ESPHomeCatalogPickerDialog;

  static styles = [espHomeStyles, inputStyles, automationEditorStyles];

  protected render() {
    return html`
      <div class=${this.noHeader ? "" : "ae-section"}>
        ${this.noHeader
          ? nothing
          : html`<label class="ae-section-label"
              >${this._localize("device.automation_action")}</label
            >`}
        ${this.actions.length === 0
          ? html`<p class="ae-empty-block" role="status">
              ${this._localize("device.automation_actions_empty")}
            </p>`
          : this.actions.map((node, idx) =>
              this._renderRow(node, idx, idx === this.actions.length - 1)
            )}
        ${this.hideAdd
          ? nothing
          : html`<button
              type="button"
              class="ae-add"
              ?disabled=${this.disabled || this.catalog.length === 0}
              @click=${this.openPicker}
            >
              <wa-icon library="mdi" name="plus"></wa-icon>
              ${this._localize("device.add_action")}
            </button>`}
        <esphome-catalog-picker-dialog
          kind="action"
          .items=${this.catalog}
          .devices=${this.devices}
          @catalog-picked=${this._onActionPicked}
        ></esphome-catalog-picker-dialog>
      </div>
    `;
  }

  public openPicker = () => {
    if (this.catalog.length === 0) return;
    this._picker.open();
  };

  private _renderRow(node: ActionNode, idx: number, isLast: boolean) {
    return html`<esphome-automation-action-node
      .value=${node}
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

  private _onActionPicked = (e: CustomEvent<CatalogPickedDetail>) => {
    e.stopPropagation();
    const node = emptyActionNode(e.detail.id);
    if (e.detail.preFilledParams) {
      node.params = { ...node.params, ...e.detail.preFilledParams };
    }
    this._emit([...this.actions, node]);
  };

  private _onActionChange(idx: number, e: CustomEvent<{ value: ActionNode }>) {
    e.stopPropagation();
    this._emit(replaceAt(this.actions, idx, e.detail.value));
  }

  private _onReorder(idx: number, e: CustomEvent<{ delta: number }>) {
    e.stopPropagation();
    this._emit(swap(this.actions, idx, idx + e.detail.delta));
  }

  private _onDelete(idx: number, e: Event) {
    e.stopPropagation();
    this._emit(removeAt(this.actions, idx));
  }

  private _emit(actions: ActionNode[]) {
    this.dispatchEvent(
      new CustomEvent("actions-change", {
        detail: { actions },
        bubbles: true,
        composed: true,
      })
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-automation-action-list": ESPHomeAutomationActionList;
  }
}
