/**
 * Generic accordion section inside the dashboard's Filters popover:
 * a collapsible header over a checkbox list of ``options``, with an
 * inline search field when ``searchable``.
 *
 * Never mutates its own ``expanded`` — header clicks emit a bubbling
 * ``filter-section-toggle`` and the popover shell writes ``expanded``
 * back. ``selected`` is a one-way prop; changes emit a bubbling
 * ``facet-change`` ``CustomEvent<string[]>`` with the full new id
 * set.
 */
import { mdiCheck, mdiChevronDown, mdiMagnify } from "@mdi/js";
import { LitElement, html, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { espHomeStyles } from "../../styles/shared.js";
import type { FacetOption } from "../../util/facets.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { toggleSelection } from "../../util/toggle-selection.js";
import { filterSectionStyles } from "./filter-section.styles.js";
import { filterStyles } from "./filter-styles.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({
  check: mdiCheck,
  "chevron-down": mdiChevronDown,
  magnify: mdiMagnify,
});

@customElement("esphome-filter-section")
export class ESPHomeFilterSection extends LitElement {
  /** Dimension display name — rendered in the header and used as
   *  the ARIA label on the option list. */
  @property() name = "";

  /** Open state. Reflected so the chevron can rotate via CSS.
   *  Written exclusively by the popover shell. */
  @property({ type: Boolean, reflect: true }) expanded = false;

  /** When true, render a search box at the top of the body. Only
   *  worth surfacing when ``options.length`` is large enough that
   *  scanning is painful — set per-dimension by the caller. */
  @property({ type: Boolean }) searchable = false;

  /** Placeholder for the search input; defaults to the section name
   *  so callers don't have to localise twice. */
  @property({ attribute: "search-placeholder" }) searchPlaceholder = "";

  /** Empty-state copy when the dimension has no options at all. */
  @property({ attribute: "empty-label" }) emptyLabel = "";

  /** Empty-state copy when a search query matches nothing. */
  @property({ attribute: "no-matches-label" }) noMatchesLabel = "";

  /** Full option list. */
  @property({ attribute: false })
  options: FacetOption[] = [];

  /** Selected option ids. Source of truth lives on the parent
   *  page so URL ↔ state serialisation stays in one place. */
  @property({ attribute: false })
  selected: string[] = [];

  @state() private _query = "";

  @query(".facet-search-input") private _searchInputEl?: HTMLInputElement;

  static styles = [espHomeStyles, filterStyles, filterSectionStyles];

  protected willUpdate(changed: Map<string, unknown>) {
    if (changed.has("expanded") && !this.expanded) this._query = "";
  }

  protected updated(changed: Map<string, unknown>) {
    if (changed.has("expanded") && this.expanded && this.searchable) {
      requestAnimationFrame(() => this._searchInputEl?.focus());
    }
  }

  protected render() {
    return html`
      <button
        class="section-header"
        type="button"
        aria-expanded=${this.expanded ? "true" : "false"}
        @click=${this._onHeaderClick}
      >
        <span class="section-name">${this.name}</span>
        ${
          this.selected.length > 0
            ? html`<span class="section-count" aria-hidden="true"
                >${this.selected.length}</span
              >`
            : nothing
        }
        <span class="section-chevron" aria-hidden="true">
          <wa-icon library="mdi" name="chevron-down"></wa-icon>
        </span>
      </button>
      ${this.expanded ? this._renderBody() : nothing}
    `;
  }

  private _renderBody() {
    const selectedSet = new Set(this.selected);
    const query = this._query.trim().toLowerCase();
    const visible = query
      ? this.options.filter((o) => o.name.toLowerCase().includes(query))
      : this.options;
    return html`
      <div class="section-body">
        ${
          this.searchable
            ? html`<div class="facet-search">
                <wa-icon
                  class="facet-search-icon"
                  library="mdi"
                  name="magnify"
                  aria-hidden="true"
                ></wa-icon>
                <input
                  class="facet-search-input"
                  type="search"
                  autocomplete="off"
                  placeholder=${this.searchPlaceholder || this.name}
                  aria-label=${this.searchPlaceholder || this.name}
                  .value=${this._query}
                  @input=${(e: Event) => {
                    this._query = (e.currentTarget as HTMLInputElement).value;
                  }}
                />
              </div>`
            : nothing
        }
        ${
          visible.length === 0
            ? html`<div class="facet-empty" role="status">
                ${query ? this.noMatchesLabel : this.emptyLabel}
              </div>`
            : html`<div class="facet-list" role="group" aria-label=${this.name}>
                ${visible.map((option) => {
                  const checked = selectedSet.has(option.id);
                  return html`<button
                    class="facet-row"
                    type="button"
                    role="checkbox"
                    aria-checked=${checked ? "true" : "false"}
                    @click=${() => this._toggleOption(option.id, !checked)}
                  >
                    <span class="facet-row-check" aria-hidden="true">
                      ${
                        checked
                          ? html`<wa-icon library="mdi" name="check"></wa-icon>`
                          : nothing
                      }
                    </span>
                    <span class="facet-row-name">${option.name}</span>
                    ${
                      option.count >= 0
                        ? html`<span class="facet-row-count" aria-hidden="true"
                            >${option.count}</span
                          >`
                        : nothing
                    }
                  </button>`;
                })}
              </div>`
        }
      </div>
    `;
  }

  private _onHeaderClick = () => {
    this.dispatchEvent(
      new CustomEvent("filter-section-toggle", { bubbles: true, composed: true })
    );
  };

  private _toggleOption(id: string, select: boolean) {
    const next = toggleSelection(this.selected, id, select);
    if (next === this.selected) return;
    this._emit([...next]);
  }

  private _emit(next: string[]) {
    this.dispatchEvent(
      new CustomEvent<string[]>("facet-change", {
        detail: next,
        bubbles: true,
        composed: true,
      })
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-filter-section": ESPHomeFilterSection;
  }
}
