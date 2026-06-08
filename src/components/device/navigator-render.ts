import { html, nothing, type TemplateResult } from "lit";
import { ifDefined } from "lit/directives/if-defined.js";
import type { YamlSection } from "../../util/yaml-sections.js";
import type { NavGroup } from "./navigator-groups.js";
import { type NavRow, prettyDomain } from "./navigator-labels.js";
import { iconForDomain } from "./navigator-row-icons.js";

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
  /** When set, ``rows`` are rendered under collapsible domain subgroups
   *  instead of as a flat list. */
  groups?: NavGroup[];
  collapsedGroups?: Set<string>;
  onToggleGroup?: (key: string) => void;
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

/** One collapsible domain subgroup: header (name + count) then its rows. */
function renderNavGroup(group: NavGroup, v: NavSectionView): TemplateResult {
  // Force open while filtering — you can't collapse a search result, so
  // the header is a static label there (no toggle, no focus, no chevron).
  const open = v.filtering || !v.collapsedGroups?.has(group.key);
  const interactive = !v.filtering;
  const toggle = () => {
    if (interactive) v.onToggleGroup?.(group.key);
  };
  const rowsId = `navgroup-${group.key}`;
  return html`
    <div
      class="nav-subgroup-header ${interactive ? "" : "nav-subgroup-header--static"}"
      role=${ifDefined(interactive ? "button" : undefined)}
      tabindex=${ifDefined(interactive ? "0" : undefined)}
      aria-expanded=${ifDefined(interactive ? String(open) : undefined)}
      aria-controls=${ifDefined(interactive ? rowsId : undefined)}
      @click=${toggle}
      @keydown=${(e: KeyboardEvent) => {
        if (interactive && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          toggle();
        }
      }}
    >
      <wa-icon
        class="nav-subgroup-icon"
        library="mdi"
        name=${iconForDomain(group.key)}
      ></wa-icon>
      <span class="nav-subgroup-title">${prettyDomain(group.key)}</span>
      <span class="nav-subgroup-count">${group.rows.length}</span>
      ${interactive
        ? html`<wa-icon
            class="nav-subgroup-chevron"
            library="mdi"
            name=${open ? "chevron-up" : "chevron-down"}
          ></wa-icon>`
        : nothing}
    </div>
    ${open
      ? html`<div id=${rowsId} class="nav-items nav-items--grouped">
          ${group.rows.map((row) => renderNavRow(row, v))}
        </div>`
      : nothing}
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
          ${v.groups
            ? v.groups.map((group) => renderNavGroup(group, v))
            : v.rows.length > 0
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
