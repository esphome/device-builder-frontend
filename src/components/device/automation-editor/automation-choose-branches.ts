/**
 * Renders a ``choose`` action's branches: each an "If" condition tree
 * plus a "Then" action list, with add / remove / reorder. The trailing
 * "Otherwise" list stays with the action node (it is the ``else`` child
 * list). Pure-presentational: emits ``branches-change`` on every
 * mutation.
 *
 * ``<esphome-automation-action-list>`` is not imported here, to keep the
 * node → branches → list → node cycle out of the module graph; the list
 * that renders the owning node has already registered it.
 */
import { consume } from "@lit/context";
import { mdiArrowDown, mdiArrowUp, mdiDelete, mdiPlus } from "@mdi/js";
import { css, html, LitElement, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";

import type {
  ActionNode,
  AutomationAction,
  AutomationCondition,
  AvailableComponentInstance,
  AvailableScript,
  ChooseBranch,
  ConditionNode,
} from "../../../api/types/automations.js";
import type { BoardCatalogEntry } from "../../../api/types/boards.js";
import type { LocalizeFunc } from "../../../common/localize.js";
import { localizeContext } from "../../../context/index.js";
import { espHomeStyles } from "../../../styles/shared.js";
import { fireEvent } from "../../../util/fire-event.js";
import { registerMdiIcons } from "../../../util/register-icons.js";
import { scrollFlashRow } from "../field-highlight.js";
import { fieldHighlightStyles } from "../field-highlight.styles.js";
import "./automation-condition-tree.js";
import { automationEditorStyles } from "./automation-editor.styles.js";
import {
  type AutomationFocus,
  childFocus,
  focusTargetHasChanged,
} from "./automation-focus.js";
import { RowKeys } from "./row-keys.js";
import { emptyChooseBranch, removeAt, replaceAt, swap } from "./serialise.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({
  "arrow-down": mdiArrowDown,
  "arrow-up": mdiArrowUp,
  delete: mdiDelete,
  plus: mdiPlus,
});

@customElement("esphome-automation-choose-branches")
export class ESPHomeAutomationChooseBranches extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @property({ attribute: false })
  branches: ChooseBranch[] = [];

  @property({ attribute: false })
  catalog: AutomationAction[] = [];

  @property({ attribute: false })
  conditionCatalog: AutomationCondition[] = [];

  @property({ attribute: false })
  scripts: AvailableScript[] = [];

  @property({ attribute: false })
  devices: AvailableComponentInstance[] = [];

  @property({ attribute: false })
  board: BoardCatalogEntry | null = null;

  @property() yaml = "";

  @property({ type: Boolean })
  disabled = false;

  /** Cursor focus target: ``[idx, "conditions" | "then", …]`` addresses
   *  a branch's gate or its action list. */
  @property({ attribute: false, hasChanged: focusTargetHasChanged })
  focusTarget: AutomationFocus | null = null;

  private readonly _rows = new RowKeys<ChooseBranch>();

  /** Branch-level scroll spent on the current target; see the action node. */
  private _focusScrolled = false;

  /** The control that asked for a reorder; see the action list. */
  private _refocus: HTMLElement | null = null;

  /** Key of the branch the caret's target was handed to; see the action list. */
  private _focusRow: number | undefined;

  static styles = [
    espHomeStyles,
    automationEditorStyles,
    fieldHighlightStyles,
    css`
      .ae-branch-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wa-space-xs);
      }
      .ae-branch-header .ae-nested-label {
        margin-bottom: 0;
      }
    `,
  ];

  protected willUpdate(changed: PropertyValues<this>): void {
    if (!changed.has("focusTarget")) return;
    this._focusScrolled = false;
    const at = this.focusTarget?.node[0];
    this._focusRow =
      typeof at === "number" ? this._rows.keysFor(this.branches)[at] : undefined;
  }

  protected updated(changed: PropertyValues<this>): void {
    if (changed.has("branches")) this._refocus?.focus();
    this._refocus = null;
    const t = this.focusTarget;
    if (!t || this._focusScrolled) return;
    this._focusScrolled = true;
    // A target that ends on the branch itself (no gate or list below it)
    // is flashed here; deeper targets are forwarded to the child trees.
    if (t.node.length !== 1 || typeof t.node[0] !== "number") return;
    const row = this.shadowRoot?.querySelectorAll<HTMLElement>(".ae-nested")[t.node[0]];
    if (row) scrollFlashRow(row);
  }

  protected render() {
    const keys = this._rows.keysFor(this.branches);
    return html`
      ${repeat(
        this.branches,
        (_branch, idx) => keys[idx],
        (branch, idx) => this._renderBranch(branch, idx, keys[idx])
      )}
      <button
        type="button"
        class="ae-add"
        ?disabled=${this.disabled}
        @click=${this._addBranch}
      >
        <wa-icon library="mdi" name="plus"></wa-icon>
        ${this._localize("device.automation_add_branch")}
      </button>
    `;
  }

  private _renderBranch(branch: ChooseBranch, idx: number, key: number) {
    const focus =
      this.focusTarget?.node[0] === idx && key === this._focusRow
        ? childFocus(this.focusTarget)
        : null;
    return html`<div class="ae-nested">
      <div class="ae-branch-header">
        <p class="ae-nested-label">
          ${this._localize("device.automation_branch", { n: idx + 1 })}
        </p>
        <div class="ae-row-controls">
          <button
            type="button"
            ?disabled=${this.disabled || idx === 0}
            aria-label=${this._localize("device.automation_move_up")}
            @click=${(e: Event) => this._move(e, idx, -1)}
          >
            <wa-icon library="mdi" name="arrow-up"></wa-icon>
          </button>
          <button
            type="button"
            ?disabled=${this.disabled || idx === this.branches.length - 1}
            aria-label=${this._localize("device.automation_move_down")}
            @click=${(e: Event) => this._move(e, idx, +1)}
          >
            <wa-icon library="mdi" name="arrow-down"></wa-icon>
          </button>
          <button
            type="button"
            class="ae-row-delete"
            ?disabled=${this.disabled || this.branches.length === 1}
            aria-label=${this._localize("device.automation_remove_branch")}
            @click=${() => this._emit(removeAt(this.branches, idx))}
          >
            <wa-icon library="mdi" name="delete"></wa-icon>
          </button>
        </div>
      </div>
      <p class="ae-nested-label">${this._localize("device.automation_branch_if")}</p>
      <esphome-automation-condition-tree
        no-header
        .conditions=${branch.conditions}
        .focusTarget=${focus?.node[0] === "conditions" ? childFocus(focus) : null}
        .catalog=${this.conditionCatalog}
        .devices=${this.devices}
        .board=${this.board}
        .yaml=${this.yaml}
        ?disabled=${this.disabled}
        @conditions-change=${(e: CustomEvent<{ conditions: ConditionNode[] }>) => {
          e.stopPropagation();
          this._patch(idx, { conditions: e.detail.conditions });
        }}
      ></esphome-automation-condition-tree>
      <p class="ae-nested-label">${this._localize("device.automation_branch_then")}</p>
      <esphome-automation-action-list
        no-header
        .actions=${branch.actions}
        .focusTarget=${focus?.node[0] === "then" ? childFocus(focus) : null}
        .catalog=${this.catalog}
        .conditionCatalog=${this.conditionCatalog}
        .scripts=${this.scripts}
        .devices=${this.devices}
        .board=${this.board}
        .yaml=${this.yaml}
        ?disabled=${this.disabled}
        @actions-change=${(e: CustomEvent<{ actions: ActionNode[] }>) => {
          // Stop the nested list's event here, or the list owning the
          // choose node would take it as its own list changing.
          e.stopPropagation();
          this._patch(idx, { actions: e.detail.actions });
        }}
      ></esphome-automation-action-list>
    </div>`;
  }

  private _move(e: Event, idx: number, delta: number) {
    this._refocus = e.currentTarget as HTMLElement;
    this._emit(swap(this.branches, idx, idx + delta));
  }

  private _patch(idx: number, patch: Partial<ChooseBranch>) {
    this._emit(replaceAt(this.branches, idx, { ...this.branches[idx], ...patch }));
  }

  private _addBranch = () => {
    this._emit([...this.branches, emptyChooseBranch()]);
  };

  private _emit(branches: ChooseBranch[]) {
    fireEvent(this, "branches-change", { branches });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-automation-choose-branches": ESPHomeAutomationChooseBranches;
  }
}
