/**
 * Single "Filters" trigger + popover hosting the slotted accordion
 * sections. Owns open state, the count badge, the header "Clear all"
 * (a bubbling ``clear-filters``), and exclusive-open coordination:
 * the shell is the single writer of every section's ``expanded``,
 * reached through ``this.children`` because slot assignment is empty
 * while the popover is closed.
 *
 * Popover / dismiss are hand-rolled (not ``wa-popover``, dismissal via
 * the shared :class:`LightDismissController`) so the document-level
 * dismissal can't fight the modal dialogs that label management opens
 * after a ``request-popover-close``.
 */
import { mdiFilterVariant } from "@mdi/js";
import { LitElement, html, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { espHomeStyles } from "../../styles/shared.js";
import { textStyles } from "../../styles/text.js";
import { fireEvent } from "../../util/fire-event.js";
import { LightDismissController } from "../../util/light-dismiss-controller.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { filterStyles } from "./filter-styles.js";
import { filtersPopoverStyles } from "./filters-popover.styles.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({ "filter-variant": mdiFilterVariant });

/** Duck-type for the slotted accordion sections. */
interface ExpandableSection extends HTMLElement {
  expanded: boolean;
}

function isSection(el: Element): el is ExpandableSection {
  return "expanded" in el;
}

@customElement("esphome-filters-popover")
export class ESPHomeFiltersPopover extends LitElement {
  /** Active facet-selection count; drives the badge. */
  @property({ type: Number, attribute: false }) activeCount = 0;

  /** Localized trigger label (the page passes "Filters"). */
  @property({ attribute: "button-label" }) buttonLabel = "Filters";

  /** Localized "Clear all" header copy. */
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

  private _dismiss = new LightDismissController(this, () => this._close(), {
    onEscape: (e) => {
      e.preventDefault();
      // Focus usually sits on a row inside the popover; hand it back
      // to the trigger so keyboard flow doesn't dead-end.
      this._triggerEl?.focus();
    },
  });

  static styles = [espHomeStyles, textStyles, filterStyles, filtersPopoverStyles];

  protected willUpdate(changed: Map<string, unknown>) {
    if (changed.has("_open")) this._dismiss.set(this._open);
  }

  override connectedCallback() {
    super.connectedCallback();
    window.addEventListener("resize", this._onResize);
    this.addEventListener("filter-section-toggle", this._onSectionToggle);
    this.addEventListener("request-popover-close", this._onRequestClose);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("resize", this._onResize);
    this.removeEventListener("filter-section-toggle", this._onSectionToggle);
    this.removeEventListener("request-popover-close", this._onRequestClose);
  }

  protected render() {
    return html`
      <button
        class="facet-trigger"
        type="button"
        aria-haspopup="dialog"
        aria-expanded=${this._open ? "true" : "false"}
        aria-label=${
          this.activeCount > 0 && this.countLabel ? this.countLabel : this.buttonLabel
        }
        @click=${this._toggle}
      >
        <span class="facet-trigger-icon" aria-hidden="true">
          <wa-icon library="mdi" name="filter-variant"></wa-icon>
        </span>
        <span class="facet-trigger-name">${this.buttonLabel}</span>
        ${
          this.activeCount > 0
            ? html`<span class="filters-badge" aria-hidden="true"
                >${this.activeCount}</span
              >`
            : nothing
        }
      </button>
      ${
        this._open
          ? html`<div
              class="filters-popover ${this._anchorRight ? "anchor-right" : ""}"
              role="dialog"
              aria-label=${this.buttonLabel}
            >
              <div class="filters-header">
                <span class="filters-title">${this.buttonLabel}</span>
                ${
                  this.activeCount > 0
                    ? html`<button
                        class="filters-clear-link"
                        type="button"
                        @click=${this._onClearAll}
                      >
                        ${this.clearLabel}
                      </button>`
                    : nothing
                }
              </div>
              <div class="filters-sections"><slot></slot></div>
            </div>`
          : nothing
      }
    `;
  }

  private _sections(): ExpandableSection[] {
    return Array.from(this.children).filter(isSection);
  }

  private _onSectionToggle = (e: Event) => {
    const target = e.target;
    if (!(target instanceof Element) || !isSection(target)) return;
    const next = !target.expanded;
    for (const section of this._sections()) {
      section.expanded = section === target ? next : false;
    }
  };

  private _onRequestClose = () => {
    this._close();
  };

  // The anchor side is computed at open time; rather than recompute on
  // every resize, close so it can't sit mispositioned.
  private _onResize = () => this._close();

  private _toggle = () => {
    if (this._open) {
      this._close();
      return;
    }
    // Width the popover can reach (matches the CSS width clamp).
    const reach = Math.min(340, window.innerWidth - 32);
    const rect = this._triggerEl?.getBoundingClientRect();
    // Flip to right-anchored only when opening rightward from the
    // trigger's left edge would spill past the viewport's right edge.
    this._anchorRight = rect ? rect.left + reach > window.innerWidth - 8 : false;
    this._open = true;
  };

  private _close() {
    if (!this._open) return;
    this._open = false;
    // Reset so the next open starts with every section collapsed
    // instead of resuming a stale disclosure state.
    for (const section of this._sections()) section.expanded = false;
  }

  private _onClearAll = () => {
    fireEvent(this, "clear-filters");
    this._close();
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-filters-popover": ESPHomeFiltersPopover;
  }
}
