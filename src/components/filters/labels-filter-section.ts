/**
 * Labels accordion section: ``<esphome-filter-section>``'s shape
 * plus colour chips, per-row rename / delete, and a create CTA. It
 * always renders — an empty catalog is the discovery path for
 * creating the first label. Selection changes emit a bubbling
 * ``labels-filter-change`` ``CustomEvent<string[]>``.
 *
 * Label management lives outside the popover (the dashboard's label
 * dialog / confirm dialog), so every management action emits
 * ``request-popover-close`` before its request event — a modal must
 * never coexist with the popover's document-click dismissal.
 */
import { consume } from "@lit/context";
import {
  mdiCheck,
  mdiChevronDown,
  mdiPencilOutline,
  mdiPlus,
  mdiTrashCanOutline,
} from "@mdi/js";
import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { Label } from "../../api/types/devices.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { labelsContext, localizeContext } from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import { labelChipStyles } from "../../util/label-chip-template.js";
import { labelChipStyleString } from "../../util/label-style.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { toggleSelection } from "../../util/toggle-selection.js";
import { filterSectionStyles } from "./filter-section.styles.js";
import { filterStyles } from "./filter-styles.js";
import { labelsFilterSectionStyles } from "./labels-filter-section.styles.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({
  check: mdiCheck,
  "chevron-down": mdiChevronDown,
  "pencil-outline": mdiPencilOutline,
  plus: mdiPlus,
  "trash-can-outline": mdiTrashCanOutline,
});

@customElement("esphome-labels-filter-section")
export class ESPHomeLabelsFilterSection extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: labelsContext, subscribe: true })
  @state()
  private _catalog: Label[] = [];

  /** Open state. Reflected so the chevron can rotate via CSS.
   *  Written exclusively by the popover shell. */
  @property({ type: Boolean, reflect: true }) expanded = false;

  /** Currently-selected label ids. Source of truth lives on the
   *  parent (dashboard) so we don't drift with router state /
   *  query-string serialization. */
  @property({ attribute: false })
  selected: string[] = [];

  /** Per-label assignment counts, computed by the dashboard from
   *  its devices list (via ``computeLabelUsage``). Missing entries
   *  default to ``0``. */
  @property({ attribute: false })
  usageCounts: Record<string, number> = {};

  static styles = [
    espHomeStyles,
    filterStyles,
    filterSectionStyles,
    labelChipStyles,
    labelsFilterSectionStyles,
  ];

  protected render() {
    return html`
      <button
        class="section-header"
        type="button"
        aria-expanded=${this.expanded ? "true" : "false"}
        @click=${this._onHeaderClick}
      >
        <span class="section-name">${this._localize("dashboard.filter_labels")}</span>
        ${this.selected.length > 0
          ? html`<span class="section-count" aria-hidden="true"
              >${this.selected.length}</span
            >`
          : nothing}
        <span class="section-chevron" aria-hidden="true">
          <wa-icon library="mdi" name="chevron-down"></wa-icon>
        </span>
      </button>
      ${this.expanded ? this._renderBody() : nothing}
    `;
  }

  private _renderBody() {
    const selectedSet = new Set(this.selected);
    const isEmpty = this._catalog.length === 0;
    return html`
      <div class="section-body">
        ${isEmpty
          ? html`<div class="facet-empty" role="status">
              ${this._localize("dashboard.labels_dialog_empty")}
            </div>`
          : html`<div
              class="facet-list"
              role="group"
              aria-label=${this._localize("dashboard.filter_labels")}
            >
              ${this._catalog.map((label) => this._renderRow(label, selectedSet))}
            </div>`}
        <div class="create-section ${isEmpty ? "create-section--empty" : ""}">
          <button class="create-trigger" type="button" @click=${this._onCreateClick}>
            <wa-icon library="mdi" name="plus"></wa-icon>
            ${this._localize("dashboard.labels_create")}
          </button>
        </div>
      </div>
    `;
  }

  private _renderRow(label: Label, selectedSet: Set<string>) {
    const checked = selectedSet.has(label.id);
    const count = this.usageCounts[label.id] ?? 0;
    return html`<div class="row-wrap">
      <button
        class="facet-row"
        type="button"
        role="checkbox"
        aria-checked=${checked ? "true" : "false"}
        @click=${() => this._toggleLabel(label.id, !checked)}
      >
        <span class="facet-row-check" aria-hidden="true">
          ${checked ? html`<wa-icon library="mdi" name="check"></wa-icon>` : nothing}
        </span>
        <span class="facet-row-name">
          <span class="label-chip" style=${labelChipStyleString(label.color)}
            >${label.name}</span
          >
        </span>
        <span class="facet-row-count" aria-hidden="true">${count}</span>
      </button>
      <div class="row-actions">
        <button
          class="row-action"
          type="button"
          aria-label=${this._localize("dashboard.labels_rename")}
          title=${this._localize("dashboard.labels_rename")}
          @click=${(e: Event) => this._onEditClick(e, label)}
        >
          <wa-icon library="mdi" name="pencil-outline"></wa-icon>
        </button>
        <button
          class="row-action row-action--danger"
          type="button"
          aria-label=${this._localize("dashboard.labels_delete")}
          title=${this._localize("dashboard.labels_delete")}
          @click=${(e: Event) => this._onDeleteClick(e, label)}
        >
          <wa-icon library="mdi" name="trash-can-outline"></wa-icon>
        </button>
      </div>
    </div>`;
  }

  private _onHeaderClick = () => {
    this.dispatchEvent(
      new CustomEvent("filter-section-toggle", { bubbles: true, composed: true })
    );
  };

  private _onEditClick(e: Event, label: Label) {
    e.stopPropagation();
    this._requestPopoverClose();
    this.dispatchEvent(
      new CustomEvent<Label>("request-edit-label", {
        detail: label,
        bubbles: true,
        composed: true,
      })
    );
  }

  private _onDeleteClick(e: Event, label: Label) {
    e.stopPropagation();
    this._requestPopoverClose();
    this.dispatchEvent(
      new CustomEvent<Label>("request-delete-label", {
        detail: label,
        bubbles: true,
        composed: true,
      })
    );
  }

  private _onCreateClick = () => {
    this._requestPopoverClose();
    this.dispatchEvent(
      new CustomEvent("request-create-label", { bubbles: true, composed: true })
    );
  };

  private _requestPopoverClose() {
    this.dispatchEvent(
      new CustomEvent("request-popover-close", { bubbles: true, composed: true })
    );
  }

  private _toggleLabel(labelId: string, select: boolean) {
    const next = toggleSelection(this.selected, labelId, select);
    if (next === this.selected) return;
    this._emit([...next]);
  }

  private _emit(next: string[]) {
    this.dispatchEvent(
      new CustomEvent<string[]>("labels-filter-change", {
        detail: next,
        bubbles: true,
        composed: true,
      })
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-labels-filter-section": ESPHomeLabelsFilterSection;
  }
}
