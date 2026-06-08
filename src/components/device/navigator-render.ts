import { html, nothing, type TemplateResult } from "lit";
import type { YamlSection } from "../../util/yaml-sections.js";
import type { NavRow } from "./navigator-labels.js";

/** A "+ Add X" affordance at the foot of a section. */
export interface NavAction {
  label: string;
  icon: string;
  onClick: () => void;
}

/** Everything one section block needs to render itself. */
export interface NavSectionView {
  label: string;
  icon: string;
  desc: string;
  actions: NavAction[];
  rows: NavRow[];
  open: boolean;
  filtering: boolean;
  selectedLine: number | null;
  hoveredLine: number | null;
  onToggle: () => void;
  onItemEnter: (item: YamlSection) => void;
  onItemLeave: () => void;
  onItemClick: (item: YamlSection) => void;
}

/** One navigator row; shared by the filtered and unfiltered paths. */
function renderNavRow(row: NavRow, v: NavSectionView): TemplateResult {
  const { item, labels } = row;
  const { primary, secondary } = labels;
  return html`
    <div
      class="nav-item ${v.selectedLine === item.fromLine
        ? "nav-item--selected"
        : ""} ${v.hoveredLine === item.fromLine ? "nav-item--hovered" : ""}"
      @mouseenter=${() => v.onItemEnter(item)}
      @mouseleave=${() => v.onItemLeave()}
      @click=${() => v.onItemClick(item)}
    >
      <div class="nav-item-content">
        <p>${primary}</p>
        ${secondary ? html`<span class="nav-item-subtitle">${secondary}</span>` : nothing}
      </div>
      <wa-icon library="mdi" name="chevron-right"></wa-icon>
    </div>
  `;
}

function renderNavAction(action: NavAction): TemplateResult {
  return html`<div class="action-item" @click=${() => action.onClick()}>
    <div>
      <wa-icon library="mdi" name=${action.icon}></wa-icon>
      <p>${action.label}</p>
    </div>
    <wa-icon library="mdi" name="plus-circle-outline"></wa-icon>
  </div>`;
}

/**
 * One section block: header (collapsible when not filtering), its rows,
 * and the "+ Add X" actions. Returns ``nothing`` while filtering when the
 * section has no matches so it drops out of the list entirely.
 */
export function renderNavSection(v: NavSectionView): TemplateResult | typeof nothing {
  if (v.filtering && v.rows.length === 0) return nothing;
  return html`
    <div class="nav-content" @click=${() => v.onToggle()}>
      <div class="nav-content-label">
        <wa-icon library="mdi" name=${v.icon}></wa-icon>
        <p>${v.label}</p>
      </div>
      ${v.filtering
        ? nothing
        : html`<wa-icon
            class="nav-content-chevron"
            library="mdi"
            name=${v.open ? "chevron-up" : "chevron-down"}
          ></wa-icon>`}
    </div>
    ${v.open
      ? html`
          <div class="separator"></div>
          ${v.filtering ? nothing : html`<p class="italic">${v.desc}</p>`}
          ${v.rows.length > 0
            ? html`<div class="nav-items">
                ${v.rows.map((row) => renderNavRow(row, v))}
              </div>`
            : nothing}
          ${v.filtering
            ? nothing
            : html`<div class="nav-items">
                ${v.actions.map((action) => renderNavAction(action))}
              </div>`}
        `
      : nothing}
    <div class="separator"></div>
  `;
}
