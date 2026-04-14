import { consume } from "@lit/context";
import { mdiUpdate } from "@mdi/js";
import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { LocalizeFunc } from "../common/localize.js";
import { localizeContext } from "../context/index.js";
import { espHomeStyles } from "../styles/shared.js";
import { registerMdiIcons } from "../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({ update: mdiUpdate });

@customElement("esphome-select-bar")
export class ESPHomeSelectBar extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @property({ type: Number, attribute: "selected-count" })
  selectedCount = 0;

  @property({ type: Number, attribute: "total-count" })
  totalCount = 0;

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
        background: var(--wa-color-surface-raised);
        border-top: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.1);
        z-index: 20;
        animation: slide-in 0.2s ease-out;
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

      .btn wa-icon {
        font-size: 16px;
      }
    `,
  ];

  protected render() {
    const allSelected =
      this.selectedCount === this.totalCount && this.totalCount > 0;

    return html`
      <div class="select-bar">
        <div class="left">
          <button
            class="toggle"
            @click=${() =>
              this._emit(allSelected ? "deselect-all" : "select-all")}
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
          <button class="btn btn--cancel" @click=${() => this._emit("cancel")}>
            ${this._localize("layout.cancel")}
          </button>
          <button
            class="btn btn--primary"
            ?disabled=${this.selectedCount === 0}
            @click=${() => this._emit("update-selected")}
          >
            <wa-icon library="mdi" name="update"></wa-icon>
            ${this._localize("dashboard.update_selected", {
              count: this.selectedCount,
            })}
          </button>
        </div>
      </div>
    `;
  }

  private _emit(name: string) {
    this.dispatchEvent(
      new CustomEvent(name, { bubbles: true, composed: true }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-select-bar": ESPHomeSelectBar;
  }
}
