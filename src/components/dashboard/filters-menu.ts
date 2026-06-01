/**
 * Collapses the dashboard's four facet pills into one trigger +
 * popover when the toolbar is too narrow for them inline. The pills
 * are slotted in by the dashboard unchanged, so this is a
 * presentational wrapper owning only open state and the "Clear all"
 * action (a bubbling ``clear-filters`` event the page already handles).
 *
 * Popover/dismiss are hand-rolled (not ``wa-popover``) to match the
 * sibling ``esphome-facet-filter`` / ``esphome-labels-filter`` and
 * share ``facetStyles``; it also avoids a WebAwesome light-dismiss
 * fighting the nested facet popovers slotted inside.
 */
import { mdiFilterVariant } from "@mdi/js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { espHomeStyles } from "../../styles/shared.js";
import { EscapeController } from "../../util/escape-controller.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { facetStyles } from "../facets/facet-styles.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({ "filter-variant": mdiFilterVariant });

@customElement("esphome-filters-menu")
export class ESPHomeFiltersMenu extends LitElement {
  /** Active facet-selection count; drives the badge. */
  @property({ type: Number, attribute: false }) activeCount = 0;

  /** Localized trigger label (the page passes "Filters"). */
  @property({ attribute: "button-label" }) buttonLabel = "Filters";

  /** Localized "Clear all" footer copy — reuses the dashboard's
   *  existing ``filter_clear_all`` key. */
  @property({ attribute: "clear-label" }) clearLabel = "Clear filters";

  /** Localized "{count} active filters" — the trigger's accessible
   *  name when active, so the bare badge number gets meaning. */
  @property({ attribute: "count-label" }) countLabel = "";

  @state() private _open = false;
  /** Open side, decided per-open in _toggle to keep the popover
   *  on-screen: right-anchored (opens leftward) only when the trigger
   *  is near the viewport's right edge. */
  @state() private _anchorRight = false;

  @query(".facet-trigger") private _triggerEl?: HTMLButtonElement;

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

      .filters-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 18px;
        height: 18px;
        padding: 0 5px;
        border-radius: 9px;
        background: var(--esphome-primary);
        color: var(--esphome-on-primary);
        font-size: var(--wa-font-size-2xs);
        font-weight: var(--wa-font-weight-semibold, 600);
        line-height: 1;
        font-variant-numeric: tabular-nums;
      }

      /* Unlike .facet-popover this stays overflow-visible so the
         nested facet popovers opening below each pill aren't clipped. */
      .filters-popover {
        position: absolute;
        z-index: 10;
        top: calc(100% + 6px);
        left: 0;
        min-width: min(240px, calc(100vw - 32px));
        max-width: min(300px, calc(100vw - 32px));
        background: var(--wa-color-surface-default);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        border-radius: var(--wa-border-radius-l);
        box-shadow: var(--wa-shadow-m);
        padding: var(--wa-space-2xs);
        display: flex;
        flex-direction: column;
      }

      .filters-popover.anchor-right {
        left: auto;
        right: 0;
      }

      .filters-list {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-2xs);
        padding: var(--wa-space-2xs);
      }

      ::slotted(esphome-labels-filter),
      ::slotted(esphome-facet-filter) {
        display: block;
      }
    `,
  ];

  protected willUpdate(changed: Map<string, unknown>) {
    if (changed.has("_open")) this._escape.set(this._open);
  }

  override connectedCallback() {
    super.connectedCallback();
    document.addEventListener("click", this._onDocumentClick, true);
    window.addEventListener("resize", this._onResize);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener("click", this._onDocumentClick, true);
    window.removeEventListener("resize", this._onResize);
  }

  private _onDocumentClick = (e: MouseEvent) => {
    if (!this._open) return;
    if (e.composedPath().includes(this)) return;
    this._close();
  };

  // The anchor side is computed at open time; rather than recompute on
  // every resize, close so it can't sit mispositioned.
  private _onResize = () => this._close();

  protected render() {
    return html`
      <button
        class="facet-trigger"
        type="button"
        aria-haspopup="dialog"
        aria-expanded=${this._open ? "true" : "false"}
        aria-label=${this.activeCount > 0 && this.countLabel
          ? this.countLabel
          : this.buttonLabel}
        @click=${this._toggle}
      >
        <span class="facet-trigger-icon" aria-hidden="true">
          <wa-icon library="mdi" name="filter-variant"></wa-icon>
        </span>
        <span class="facet-trigger-name">${this.buttonLabel}</span>
        ${this.activeCount > 0
          ? html`<span class="filters-badge" aria-hidden="true"
              >${this.activeCount}</span
            >`
          : nothing}
      </button>
      ${this._open
        ? html`<div
            class="filters-popover ${this._anchorRight ? "anchor-right" : ""}"
            role="dialog"
            aria-label=${this.buttonLabel}
          >
            <div class="filters-list"><slot></slot></div>
            ${this.activeCount > 0
              ? html`<div class="facet-footer">
                  <button
                    class="facet-clear-link"
                    type="button"
                    @click=${this._onClearAll}
                  >
                    ${this.clearLabel}
                  </button>
                </div>`
              : nothing}
          </div>`
        : nothing}
    `;
  }

  private _toggle = () => {
    if (!this._open) {
      // Width the popover can reach (matches the CSS max-width clamp).
      const reach = Math.min(300, window.innerWidth - 32);
      const rect = this._triggerEl?.getBoundingClientRect();
      // Flip to right-anchored only when opening rightward from the
      // trigger's left edge would spill past the viewport's right edge.
      this._anchorRight = rect ? rect.left + reach > window.innerWidth - 8 : false;
    }
    this._open = !this._open;
  };

  private _close() {
    if (!this._open) return;
    this._open = false;
  }

  private _onClearAll = () => {
    this.dispatchEvent(
      new CustomEvent("clear-filters", { bubbles: true, composed: true })
    );
    this._close();
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-filters-menu": ESPHomeFiltersMenu;
  }
}
