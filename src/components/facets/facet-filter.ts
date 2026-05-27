/**
 * Generic faceted-filter pill used by the dashboard toolbar.
 *
 * Renders one filter dimension as a rounded "pill" trigger:
 *
 *  - Empty state: dashed outline + plus icon + facet name. Reads
 *    as "click to add this filter".
 *  - Active state: solid outline + clear-circle icon + facet name
 *    + a small summary chip showing either the single selection's
 *    name or "N selected". Clicking the clear-circle wipes the
 *    facet without opening the popover; clicking anywhere else on
 *    the pill toggles the popover.
 *
 * The popover hosts a checkbox list of the supplied ``options``.
 * Each option carries an ``id`` (returned through the change
 * event), a display ``name``, and a ``count`` for the right-edge
 * badge. When ``searchable`` is true an in-popover text field
 * filters the list by display name.
 *
 * State lives on the consumer: ``selected`` is a one-way prop
 * (array of option ids) and selection changes are emitted as a
 * bubbling ``facet-change`` ``CustomEvent<string[]>`` carrying the
 * full new id set. This mirrors the existing
 * ``<esphome-labels-filter>`` shape so the dashboard's filter
 * pipeline can treat both surfaces uniformly.
 */
import { mdiCheck, mdiClose, mdiMagnify, mdiPlus } from "@mdi/js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { espHomeStyles } from "../../styles/shared.js";
import { EscapeController } from "../../util/escape-controller.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { facetStyles } from "./facet-styles.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({
  check: mdiCheck,
  close: mdiClose,
  magnify: mdiMagnify,
  plus: mdiPlus,
});

/** One selectable value inside a facet. */
export interface FacetOption {
  /** Opaque id surfaced through the ``facet-change`` event. */
  id: string;
  /** Display name rendered as the row label and as the active-pill
   *  summary when this is the sole selection. */
  name: string;
  /** Right-edge badge count. ``0`` is a meaningful value (filters
   *  with no matching devices still render so the user can see the
   *  empty option) — pass ``-1`` to suppress the badge entirely. */
  count: number;
}

@customElement("esphome-facet-filter")
export class ESPHomeFacetFilter extends LitElement {
  /** Facet display name — rendered inside the trigger pill and
   *  used as the ARIA group label on the popover. */
  @property() name = "";

  /** Placeholder shown in the in-popover search input. Defaults to
   *  the facet name when omitted, which keeps the popover usable
   *  without forcing every caller to localise twice. */
  @property({ attribute: "search-placeholder" }) searchPlaceholder = "";

  /** Copy for the "Clear filters" footer link. Required when the
   *  caller wants the link localised; falls back to a quiet
   *  English default so a missing prop doesn't render blank. */
  @property({ attribute: "clear-label" }) clearLabel = "Clear filters";

  /** Copy for the multi-selection summary chip when more than one
   *  option is selected. ``{count}`` is interpolated. */
  @property({ attribute: "multi-selected-label" })
  multiSelectedLabel = "{count} selected";

  /** When true, render a search box at the top of the popover.
   *  Only worth surfacing when ``options.length`` is large enough
   *  that scanning is painful — set per-facet by the caller. */
  @property({ type: Boolean }) searchable = false;

  /** Anchor the popover to the trigger's right edge instead of
   *  its left. Useful when the facet sits at the right edge of
   *  the toolbar where a left-anchored popover would overflow. */
  @property({ type: Boolean, attribute: "anchor-right" }) anchorRight = false;

  /** Full option list. */
  @property({ attribute: false })
  options: FacetOption[] = [];

  /** Selected option ids. Source of truth lives on the parent
   *  page so URL ↔ state serialisation stays in one place. */
  @property({ attribute: false })
  selected: string[] = [];

  @state() private _open = false;
  @state() private _query = "";

  @query(".facet-search-input") private _searchInputEl?: HTMLInputElement;

  private _escape = new EscapeController(this, (e) => {
    e.preventDefault();
    this._close();
  });

  static styles = [
    espHomeStyles,
    facetStyles,
    css`
      :host {
        display: inline-block;
        position: relative;
      }
    `,
  ];

  protected willUpdate(changed: Map<string, unknown>) {
    if (changed.has("_open")) {
      this._escape.set(this._open);
      if (!this._open) this._query = "";
    }
  }

  protected updated(changed: Map<string, unknown>) {
    if (changed.has("_open") && this._open && this.searchable) {
      requestAnimationFrame(() => this._searchInputEl?.focus());
    }
  }

  override connectedCallback() {
    super.connectedCallback();
    document.addEventListener("click", this._onDocumentClick, true);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener("click", this._onDocumentClick, true);
  }

  private _onDocumentClick = (e: MouseEvent) => {
    if (!this._open) return;
    if (e.composedPath().includes(this)) return;
    this._close();
  };

  protected render() {
    const active = this.selected.length > 0;
    return html`
      <button
        class="facet-trigger"
        type="button"
        aria-haspopup="listbox"
        aria-expanded=${this._open ? "true" : "false"}
        @click=${this._toggle}
      >
        <span class="facet-trigger-icon" aria-hidden="true">
          <wa-icon library="mdi" name="plus"></wa-icon>
        </span>
        <span class="facet-trigger-name">${this.name}</span>
        ${active ? this._renderBadges() : nothing}
      </button>
      ${this._open ? this._renderPopover() : nothing}
    `;
  }

  /** ≤ 2 selections render one removable badge per value, > 2
   *  collapse to a single "N selected" badge whose × clears the
   *  facet. Matches the shadcn / Linear pattern: the trigger
   *  always tells you what's filtered without forcing a popover
   *  open, but grows at a bounded rate. */
  private _renderBadges() {
    const count = this.selected.length;
    return html`
      <span class="facet-trigger-divider" aria-hidden="true"></span>
      <span class="facet-trigger-badges">
        ${count > 2
          ? html`<span class="facet-trigger-badge">
              <span class="facet-trigger-badge-label"
                >${this.multiSelectedLabel.replace("{count}", String(count))}</span
              >
              <button
                class="facet-trigger-badge-remove"
                type="button"
                aria-label=${this.clearLabel}
                title=${this.clearLabel}
                @click=${this._onClearClick}
              >
                <wa-icon library="mdi" name="close"></wa-icon>
              </button>
            </span>`
          : this.selected.map((id) => {
              const opt = this.options.find((o) => o.id === id);
              const label = opt?.name ?? id;
              return html`<span class="facet-trigger-badge" title=${label}>
                <span class="facet-trigger-badge-label">${label}</span>
                <button
                  class="facet-trigger-badge-remove"
                  type="button"
                  aria-label=${this.clearLabel}
                  title=${this.clearLabel}
                  @click=${(e: Event) => this._onRemoveOne(e, id)}
                >
                  <wa-icon library="mdi" name="close"></wa-icon>
                </button>
              </span>`;
            })}
      </span>
    `;
  }

  private _renderPopover() {
    const selectedSet = new Set(this.selected);
    const query = this._query.trim().toLowerCase();
    const visible = query
      ? this.options.filter((o) => o.name.toLowerCase().includes(query))
      : this.options;
    return html`
      <div
        class="facet-popover ${this.anchorRight ? "facet-popover--anchor-right" : ""}"
        role="group"
        aria-label=${this.name}
      >
        ${this.searchable
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
          : nothing}
        ${visible.length === 0
          ? html`<div class="facet-empty" role="status">
              ${query ? "No matches" : "No options"}
            </div>`
          : html`<div class="facet-list" role="listbox">
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
                    ${checked
                      ? html`<wa-icon library="mdi" name="check"></wa-icon>`
                      : nothing}
                  </span>
                  <span class="facet-row-name">${option.name}</span>
                  ${option.count >= 0
                    ? html`<span class="facet-row-count" aria-hidden="true"
                        >${option.count}</span
                      >`
                    : nothing}
                </button>`;
              })}
            </div>`}
        ${this.selected.length > 0
          ? html`<div class="facet-footer">
              <button class="facet-clear-link" type="button" @click=${this._clear}>
                ${this.clearLabel}
              </button>
            </div>`
          : nothing}
      </div>
    `;
  }

  private _toggle = () => {
    this._open = !this._open;
  };

  private _close() {
    if (!this._open) return;
    this._open = false;
  }

  private _onClearClick = (e: Event) => {
    // Don't let the outer trigger button toggle the popover when
    // a badge's × is what got pressed.
    e.stopPropagation();
    this._emit([]);
    this._close();
  };

  /** Remove a single selection from the trigger badge row without
   *  opening the popover. */
  private _onRemoveOne = (e: Event, id: string) => {
    e.stopPropagation();
    this._emit(this.selected.filter((x) => x !== id));
  };

  private _toggleOption(id: string, select: boolean) {
    if (select) {
      if (this.selected.includes(id)) return;
      this._emit([...this.selected, id]);
    } else {
      this._emit(this.selected.filter((x) => x !== id));
    }
  }

  private _clear = () => {
    this._emit([]);
    this._close();
  };

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
    "esphome-facet-filter": ESPHomeFacetFilter;
  }
}
