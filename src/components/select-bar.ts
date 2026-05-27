import { consume } from "@lit/context";
import { mdiArchiveOutline, mdiClose, mdiDelete, mdiUpdate } from "@mdi/js";
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
        height: var(--select-bar-height, 64px);
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
        background: color-mix(in srgb, var(--esphome-primary), transparent 90%);
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
        padding: 8px 18px;
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
        background: color-mix(in srgb, var(--esphome-primary), black 10%);
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
    `,
  ];

  protected render() {
    const allSelected = this.allVisibleSelected;
    const cancelLabel = this._localize("layout.cancel");
    const archiveLabel = this._localize("dashboard.archive_selected", {
      count: this.selectedCount,
    });
    const deleteLabel = this._localize("dashboard.delete_selected", {
      count: this.selectedCount,
    });
    const updateLabel = this._localize("dashboard.update_selected", {
      count: this.selectedCount,
    });

    return html`
      <div class="select-bar">
        <div class="left">
          <button
            class="toggle"
            @click=${() => this._emit(allSelected ? "deselect-all" : "select-all")}
          >
            ${allSelected
              ? this._localize("dashboard.deselect_all")
              : this._localize("dashboard.select_all")}
          </button>
          <span class="count">
            ${this._localize("dashboard.selected_count", {
              count: this.selectedCount,
            })}
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
            aria-label=${archiveLabel}
            ?disabled=${this.selectedCount === 0}
            @click=${() => this._emit("archive-selected")}
          >
            <wa-icon library="mdi" name="archive-outline"></wa-icon>
            <span class="btn-label">${archiveLabel}</span>
          </button>
          <button
            class="btn btn--danger"
            aria-label=${deleteLabel}
            ?disabled=${this.selectedCount === 0}
            @click=${() => this._emit("delete-selected")}
          >
            <wa-icon library="mdi" name="delete"></wa-icon>
            <span class="btn-label">${deleteLabel}</span>
          </button>
          <button
            class="btn btn--primary"
            aria-label=${updateLabel}
            ?disabled=${this.selectedCount === 0}
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
