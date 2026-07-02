import { consume } from "@lit/context";
import {
  mdiArchiveOutline,
  mdiClose,
  mdiDelete,
  mdiTagMultiple,
  mdiUpdate,
} from "@mdi/js";
import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { LocalizeFunc } from "../common/localize.js";
import { localizeContext } from "../context/index.js";
import { espHomeStyles } from "../styles/shared.js";
import { registerMdiIcons } from "../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({
  "archive-outline": mdiArchiveOutline,
  close: mdiClose,
  delete: mdiDelete,
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

  static styles = [
    espHomeStyles,
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

      .left {
        display: flex;
        align-items: center;
        gap: var(--wa-space-m);
      }

      .count {
        font-size: var(--wa-font-size-s);
        color: var(--wa-color-text-quiet);
        font-weight: var(--wa-font-weight-semibold);
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
      }

      .toggle:hover {
        background: var(--esphome-tint);
      }

      .right {
        display: flex;
        align-items: center;
        gap: var(--wa-space-s);
      }

      .btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: var(--esphome-button-padding);
        border-radius: var(--wa-border-radius-m);
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
        font-family: inherit;
        cursor: pointer;
        border: none;
        transition:
          background 0.12s,
          opacity 0.12s;
      }

      .btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .btn--cancel {
        background: var(--wa-color-surface-lowered);
        color: var(--wa-color-text-normal);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
      }

      .btn--cancel:hover {
        background: var(--wa-color-surface-border);
      }

      .btn--primary {
        background: var(--esphome-primary);
        color: var(--esphome-on-primary);
      }

      .btn--primary:hover:not(:disabled) {
        background: var(--esphome-primary-hover);
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

      @media (max-width: 700px) {
        .select-bar {
          padding: var(--wa-space-m);
        }

        .right {
          gap: 6px;
        }

        .btn {
          padding: 8px 12px;
        }

        .btn-label {
          display: none;
        }
      }

      /* Phone widths: 5 icon-only action buttons (cancel, labels,
         archive, delete, update) plus the Select-all + count on the
         left don't fit at the 700px-breakpoint padding/gap. Tighten
         both, hide the now-redundant count text (Select-all is the
         meaningful affordance), and pull the bar's horizontal
         padding down so the trailing Update button stays on-screen. */
      @media (max-width: 480px) {
        .select-bar {
          padding: var(--wa-space-s);
        }

        .left {
          gap: var(--wa-space-s);
        }

        .count {
          display: none;
        }

        .right {
          gap: 4px;
        }

        .btn {
          padding: 8px 10px;
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
          <button
            class="btn btn--primary"
            aria-label=${updateAriaLabel}
            ?disabled=${count === 0}
            @click=${() => this._emit("update-selected")}
          >
            <wa-icon library="mdi" name="update"></wa-icon>
            <span class="btn-label">${updateLabel}</span>
          </button>
        </div>
      </div>
    `;
  }

  private _emit(name: string) {
    this.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true }));
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-select-bar": ESPHomeSelectBar;
  }
}
