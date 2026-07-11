import { consume } from "@lit/context";
import {
  mdiArchiveOutline,
  mdiChevronDown,
  mdiClose,
  mdiDelete,
  mdiHammerWrench,
  mdiTagMultiple,
  mdiUpdate,
} from "@mdi/js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { LocalizeFunc } from "../common/localize.js";
import { localizeContext } from "../context/index.js";
import { dialogActionButtonStyles } from "../styles/dialog-action-buttons.js";
import { dropdownMenuStyles } from "../styles/dropdown-menu.js";
import { espHomeStyles } from "../styles/shared.js";
import { EscapeController } from "../util/escape-controller.js";
import { registerMdiIcons } from "../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({
  "archive-outline": mdiArchiveOutline,
  "chevron-down": mdiChevronDown,
  close: mdiClose,
  delete: mdiDelete,
  "hammer-wrench": mdiHammerWrench,
  "tag-multiple": mdiTagMultiple,
  update: mdiUpdate,
});

@customElement("esphome-select-bar")
export class ESPHomeSelectBar extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @property({ type: Number, attribute: "selected-count" })
  selectedCount = 0;

  /** True when every currently-visible (filtered) device is in the
   *  parent's selection. Drives the toggle button between "Select all"
   *  and "Deselect all" so it reflects the filtered scope rather than
   *  the full device list. */
  @property({ type: Boolean, attribute: "all-visible-selected" })
  allVisibleSelected = false;

  @state()
  private _menuOpen = false;

  private _escape = new EscapeController(this, (e) => {
    e.preventDefault();
    this._menuOpen = false;
  });

  static styles = [
    espHomeStyles,
    // Shared .btn / .btn--cancel / .btn--primary chrome; the local
    // block below layers the bar-specific deltas on top.
    dialogActionButtonStyles,
    // Popover chrome (.backdrop / .menu / .menu-item) for the Update
    // split button's menu; the local block repositions the menu.
    dropdownMenuStyles,
    css`
      @keyframes slide-in {
        from {
          transform: translateY(100%);
        }
        to {
          transform: translateY(0);
        }
      }

      .select-bar {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--wa-space-m) var(--wa-space-xl);
        height: var(--select-bar-height);
        box-sizing: border-box;
        /* Locked at exactly --select-bar-height so the table host's
           padding-bottom reservation can never be undershot by a
           shorter bar or overshot by a wrapping label — the labels
           below all carry white-space:nowrap to back this guarantee. */
        background: var(--wa-color-surface-raised);
        border-top: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.1);
        z-index: 20;
        animation: slide-in 0.2s ease-out;
      }

      .select-bar .count,
      .select-bar .toggle,
      .select-bar .btn {
        white-space: nowrap;
      }

      /* The action buttons keep their size; the left group absorbs the
         squeeze at tight widths (or with long translations) by
         ellipsizing — the count first (it restates the selection the
         checkboxes already show), then the Select-all label. Without
         min-width: 0 the nowrap texts set a floor and the row overlaps
         instead of shrinking. */
      .left {
        display: flex;
        align-items: center;
        gap: var(--wa-space-m);
        min-width: 0;
      }

      .right {
        flex-shrink: 0;
      }

      .count {
        font-size: var(--wa-font-size-s);
        color: var(--wa-color-text-quiet);
        font-weight: var(--wa-font-weight-semibold);
        overflow: hidden;
        text-overflow: ellipsis;
        min-width: 0;
        flex-shrink: 4;
      }

      .toggle {
        border: none;
        background: none;
        color: var(--esphome-primary);
        cursor: pointer;
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
        font-family: inherit;
        padding: 6px 12px;
        border-radius: var(--wa-border-radius-m);
        transition: background 0.12s;
        overflow: hidden;
        text-overflow: ellipsis;
        min-width: 0;
      }

      .toggle:hover {
        background: var(--esphome-tint);
      }

      .right {
        display: flex;
        align-items: center;
        gap: var(--wa-space-s);
      }

      /* Deltas over the shared .btn chrome: icon + label sit inline,
         and every variant (not just --primary) greys out while a bulk
         action is in flight, with the opacity change animated. */
      .btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        transition:
          background 0.12s,
          opacity 0.12s;
      }

      .btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .btn--danger {
        background: transparent;
        color: var(--esphome-error);
        border: var(--wa-border-width-s) solid var(--esphome-error);
      }

      .btn--danger:hover:not(:disabled) {
        background: color-mix(in srgb, var(--esphome-error), transparent 90%);
      }

      .btn--secondary {
        background: transparent;
        color: var(--wa-color-text-normal);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
      }

      .btn--secondary:hover:not(:disabled) {
        background: var(--wa-color-surface-lowered);
      }

      .btn wa-icon {
        font-size: 16px;
      }

      .update-split {
        position: relative;
        display: inline-flex;
        align-items: stretch;
      }

      /* Join the two halves into one split control: square the inner
         corners and overlap the seam by one border width so both
         buttons keep a full border. The hovered / focused half is
         raised so it owns a single, consistent seam colour. */
      .update-split__main,
      .update-split__caret {
        position: relative;
      }

      .update-split__main {
        border-top-right-radius: 0;
        border-bottom-right-radius: 0;
      }

      .update-split__caret {
        border-top-left-radius: 0;
        border-bottom-left-radius: 0;
        margin-left: calc(-1 * var(--wa-border-width-s));
        padding-left: var(--wa-space-xs);
        padding-right: var(--wa-space-xs);
        gap: 0;
      }

      .update-split__main:hover:not(:disabled),
      .update-split__caret:hover:not(:disabled),
      .update-split__main:focus-visible,
      .update-split__caret:focus-visible {
        z-index: 1;
      }

      .menu {
        /* Anchored to the split button; the bar is fixed to the bottom
           edge, so the menu opens upward. */
        position: absolute;
        bottom: calc(100% + var(--wa-space-2xs));
        right: 0;
        min-width: 160px;
      }

      /* Redefines the shared menu-in on purpose: this menu rises from
         its bottom anchor instead of scaling in. The last @keyframes
         definition with a given name wins, and this block comes after
         dropdownMenuStyles in the styles array. */
      @keyframes menu-in {
        from {
          opacity: 0;
          transform: translateY(4px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      /* With all five labels showing, the action row's min-content is
         ~640px in headless Chrome and wider under Safari's fonts and
         in longer locales, so anywhere under ~1000px it collides with
         the Select-all + count group. Go icon-only below that; the
         left group's ellipsis is the backstop for locales whose
         labels push past it. */
      @media (max-width: 1000px) {
        .select-bar {
          padding: var(--wa-space-m);
        }

        .right {
          gap: 6px;
        }

        .btn {
          padding: 8px 12px;
        }

        .update-split__caret {
          padding: var(--wa-space-xs) 6px;
        }

        .btn-label {
          display: none;
        }
      }

      /* Phone widths: hide the now-redundant count text (Select-all
         is the meaningful affordance) and tighten the buttons enough
         for a 375px screen. The bar's own horizontal padding stays at
         --wa-space-s: it is what keeps the edge controls clear of
         phone rounded-corner / safe-area cutins. */
      @media (max-width: 480px) {
        .select-bar {
          padding: var(--wa-space-s);
        }

        .left {
          gap: var(--wa-space-2xs);
        }

        .toggle {
          padding: 6px;
        }

        .count {
          display: none;
        }

        .right {
          gap: var(--wa-space-2xs);
        }

        .btn {
          padding: var(--wa-space-xs) 10px;
        }

        .update-split__caret {
          padding: var(--wa-space-xs) var(--wa-space-2xs);
        }
      }

      /* The smallest screens (320px) need the compact sizing the
         wider phones above shouldn't pay for. */
      @media (max-width: 360px) {
        .left {
          gap: var(--wa-space-3xs);
        }

        .right {
          gap: var(--wa-space-3xs);
        }

        .btn {
          padding: var(--wa-space-xs) var(--wa-space-2xs);
        }

        .update-split__caret {
          padding: var(--wa-space-xs) var(--wa-space-3xs);
        }
      }
    `,
  ];

  protected render() {
    const allSelected = this.allVisibleSelected;
    // Normalized button labelling: visible text is the verb only
    // (keeps the row short enough to fit at tablet widths with all
    // five actions present); the count moves into ``aria-label`` so
    // screen readers still announce the scope.
    const count = this.selectedCount;
    const cancelLabel = this._localize("layout.cancel");
    const labelsLabel = this._localize("dashboard.labels_bulk_button");
    const labelsAriaLabel = this._localize("dashboard.labels_bulk_aria", { count });
    const archiveLabel = this._localize("dashboard.archive_selected");
    const archiveAriaLabel = this._localize("dashboard.archive_selected_aria", { count });
    const deleteLabel = this._localize("dashboard.delete_selected");
    const deleteAriaLabel = this._localize("dashboard.delete_selected_aria", { count });
    const updateLabel = this._localize("dashboard.update_selected");
    const updateAriaLabel = this._localize("dashboard.update_selected_aria", { count });
    const moreOptionsLabel = this._localize("dashboard.update_more_options_aria");
    const compileLabel = this._localize("dashboard.compile_selected");
    const compileAriaLabel = this._localize("dashboard.compile_selected_aria", { count });

    return html`
      <div class="select-bar">
        <div class="left">
          <button
            class="toggle"
            @click=${() => this._emit(allSelected ? "deselect-all" : "select-all")}
          >
            ${
              allSelected
                ? this._localize("dashboard.deselect_all")
                : this._localize("dashboard.select_all")
            }
          </button>
          <span class="count">
            ${this._localize("dashboard.selected_count", { count })}
          </span>
        </div>
        <div class="right">
          <button
            class="btn btn--cancel"
            aria-label=${cancelLabel}
            @click=${() => this._emit("cancel")}
          >
            <wa-icon library="mdi" name="close"></wa-icon>
            <span class="btn-label">${cancelLabel}</span>
          </button>
          <button
            class="btn btn--secondary"
            aria-label=${labelsAriaLabel}
            ?disabled=${count === 0}
            @click=${() => this._emit("labels-selected")}
          >
            <wa-icon library="mdi" name="tag-multiple"></wa-icon>
            <span class="btn-label">${labelsLabel}</span>
          </button>
          <button
            class="btn btn--secondary"
            aria-label=${archiveAriaLabel}
            ?disabled=${count === 0}
            @click=${() => this._emit("archive-selected")}
          >
            <wa-icon library="mdi" name="archive-outline"></wa-icon>
            <span class="btn-label">${archiveLabel}</span>
          </button>
          <button
            class="btn btn--danger"
            aria-label=${deleteAriaLabel}
            ?disabled=${count === 0}
            @click=${() => this._emit("delete-selected")}
          >
            <wa-icon library="mdi" name="delete"></wa-icon>
            <span class="btn-label">${deleteLabel}</span>
          </button>
          <div class="update-split">
            <button
              class="btn btn--primary update-split__main"
              aria-label=${updateAriaLabel}
              ?disabled=${count === 0}
              @click=${() => this._emit("update-selected")}
            >
              <wa-icon library="mdi" name="update"></wa-icon>
              <span class="btn-label">${updateLabel}</span>
            </button>
            <button
              class="btn btn--primary update-split__caret"
              aria-label=${moreOptionsLabel}
              title=${moreOptionsLabel}
              aria-haspopup="true"
              aria-expanded=${this._menuOpen}
              ?disabled=${count === 0}
              @click=${this._toggleMenu}
            >
              <wa-icon library="mdi" name="chevron-down"></wa-icon>
            </button>
            ${
              this._menuOpen
                ? html`
                    <div class="backdrop" @click=${this._closeMenu}></div>
                    <div class="menu" role="menu">
                      <div
                        class="menu-item"
                        role="menuitem"
                        tabindex="0"
                        aria-label=${compileAriaLabel}
                        @click=${this._onCompile}
                        @keydown=${this._onItemKeydown}
                      >
                        <wa-icon library="mdi" name="hammer-wrench"></wa-icon>
                        ${compileLabel}
                      </div>
                    </div>
                  `
                : nothing
            }
          </div>
        </div>
      </div>
    `;
  }

  protected willUpdate() {
    // An emptied selection disables the caret; take the open menu with
    // it so the disabled state can't leave a live "Compile only" row.
    if (this.selectedCount === 0) {
      this._menuOpen = false;
    }
    this._escape.set(this._menuOpen);
  }

  private _toggleMenu() {
    this._menuOpen = !this._menuOpen;
  }

  private _closeMenu() {
    this._menuOpen = false;
  }

  private _onCompile() {
    this._menuOpen = false;
    this._emit("compile-selected");
  }

  /* role + tabindex make the menu row focusable; this maps Enter /
     Space to the same click the mouse would dispatch (mirrors
     esphome-table-column-toggle). */
  private _onItemKeydown = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      (e.currentTarget as HTMLElement).click();
    }
  };

  private _emit(name: string) {
    this.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true }));
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-select-bar": ESPHomeSelectBar;
  }
}
