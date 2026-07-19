/**
 * Single-select radiogroup over configured component instances: a
 * multi-entity platform renders as a group header with its sub-entity rows.
 * Emits ``component-change`` with the picked id; controlled via ``value``.
 */
import { consume } from "@lit/context";
import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import type { AvailableComponentInstance } from "../../../api/types/automations.js";
import type { LocalizeFunc } from "../../../common/localize.js";
import { localizeContext } from "../../../context/index.js";
import { espHomeStyles } from "../../../styles/shared.js";
import { textStyles } from "../../../styles/text.js";
import { fireEvent } from "../../../util/fire-event.js";
import { componentTargetPickerStyles } from "./component-target-picker.styles.js";
import { instanceName } from "./component-targets.js";

type Group = { header: AvailableComponentInstance; subs: AvailableComponentInstance[] };

/** Arrow key → step through the flat row order (Left/Up back, Right/Down on). */
const ARROW_DELTA: Record<string, number> = {
  ArrowDown: 1,
  ArrowRight: 1,
  ArrowUp: -1,
  ArrowLeft: -1,
};

@customElement("esphome-component-target-picker")
export class ESPHomeComponentTargetPicker extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @property({ attribute: false }) devices: AvailableComponentInstance[] = [];
  @property() value = "";
  @property({ type: Boolean }) disabled = false;

  static styles = [espHomeStyles, textStyles, componentTargetPickerStyles];

  protected render() {
    const { plan, order } = this._plan();
    if (order.length === 0) {
      return html`<p class="error" role="status">
        ${this._localize("device.automation_target_no_components")}
      </p>`;
    }
    return html`<div class="field">
      <label class="field-label" id="component-target-label">
        ${this._localize("device.automation_wizard_pick_component")}
      </label>
      <div
        class="component-list"
        role="radiogroup"
        aria-labelledby="component-target-label"
        @keydown=${(e: KeyboardEvent) => this._onKeydown(e, order)}
      >
        ${plan.map((item) => {
          if (!("header" in item)) return this._renderChoice(item, order);
          const headerId = `component-group-${item.header.id}`;
          return html`<div
            class="component-group-wrap"
            role="group"
            aria-labelledby=${headerId}
          >
            <p class="component-group" id=${headerId}>
              ${instanceName(item.header)}
              <span class="component-group-id">(${item.header.component_id})</span>
            </p>
            ${item.subs.map((s) => this._renderChoice(s, order))}
          </div>`;
        })}
      </div>
    </div>`;
  }

  /** Build the render plan and the flat ``order`` together in DOM order, so
   *  roving tabindex and arrow-key nav always track the visible rows. */
  private _plan(): { plan: (AvailableComponentInstance | Group)[]; order: string[] } {
    const containerIds = new Set(
      this.devices.filter((d) => d.is_entity_container).map((d) => d.id)
    );
    const subsByParent = new Map<string, AvailableComponentInstance[]>();
    for (const d of this.devices) {
      if (!d.parent_id || !containerIds.has(d.parent_id)) continue;
      const list = subsByParent.get(d.parent_id) ?? [];
      list.push(d);
      subsByParent.set(d.parent_id, list);
    }
    const plan: (AvailableComponentInstance | Group)[] = [];
    const order: string[] = [];
    for (const d of this.devices) {
      if (d.is_entity_container) {
        const subs = subsByParent.get(d.id) ?? [];
        if (subs.length === 0) continue;
        plan.push({ header: d, subs });
        order.push(...subs.map((s) => s.id));
      } else if (!(d.parent_id && containerIds.has(d.parent_id))) {
        // Orphan sub (parent absent) or plain instance → standalone row.
        plan.push(d);
        order.push(d.id);
      }
    }
    return { plan, order };
  }

  private _renderChoice(d: AvailableComponentInstance, order: string[]) {
    const selected = d.id === this.value;
    // Roving tabindex: the checked row is the single tab stop; before any
    // pick, the first selectable row holds it.
    const tabbable = selected || (!order.includes(this.value) && order[0] === d.id);
    return html`<div
      class="component-choice ${selected ? "component-choice--selected" : ""}"
      role="radio"
      aria-checked=${selected ? "true" : "false"}
      aria-disabled=${this.disabled ? "true" : "false"}
      data-id=${d.id}
      tabindex=${tabbable ? "0" : "-1"}
      @click=${() => this._select(d.id)}
    >
      <span class="component-choice-name truncate">${instanceName(d)}</span>
      <span class="component-domain">${d.component_id}</span>
    </div>`;
  }

  /** Radiogroup keyboard model: arrows move + select across the flat order
   *  (wrapping); Enter / Space selects the focused row. */
  private _onKeydown(e: KeyboardEvent, order: string[]) {
    if (this.disabled || order.length === 0) return;
    const focused = (e.target as HTMLElement | null)?.closest(
      ".component-choice"
    ) as HTMLElement | null;
    const currentId = focused?.dataset.id ?? null;
    if (e.key === "Enter" || e.key === " ") {
      if (currentId) {
        e.preventDefault();
        this._select(currentId);
      }
      return;
    }
    const delta = ARROW_DELTA[e.key] ?? 0;
    if (delta === 0) return;
    e.preventDefault();
    const base = currentId ? order.indexOf(currentId) : -1;
    const nextId = order[(base + delta + order.length) % order.length];
    this._select(nextId);
    void this.updateComplete.then(() => {
      const el = this.shadowRoot?.querySelector(
        `.component-choice[data-id="${nextId}"]`
      ) as HTMLElement | null;
      el?.focus();
    });
  }

  private _select(id: string) {
    if (this.disabled) return;
    fireEvent(this, "component-change", { componentId: id });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-component-target-picker": ESPHomeComponentTargetPicker;
  }
}
