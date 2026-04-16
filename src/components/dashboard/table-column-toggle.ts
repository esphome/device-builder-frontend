import { consume } from "@lit/context";
import { mdiCheck, mdiCogOutline } from "@mdi/js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { localizeContext } from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import { registerMdiIcons } from "../../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({ check: mdiCheck, "cog-outline": mdiCogOutline });

export interface ToggleableColumn {
  id: string;
  header: string;
  visible: boolean;
}

@customElement("esphome-table-column-toggle")
export class ESPHomeTableColumnToggle extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @property({ attribute: false })
  columns: ToggleableColumn[] = [];

  @state()
  private _open = false;

  static styles = [
    espHomeStyles,
    css`
      :host {
        display: block;
        position: relative;
      }

      .toggle-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 14px;
        border-radius: var(--wa-border-radius-m);
        font-size: var(--wa-font-size-xs);
        font-weight: var(--wa-font-weight-bold);
        font-family: inherit;
        cursor: pointer;
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        background: var(--wa-color-surface-raised);
        color: var(--wa-color-text-normal);
        transition:
          background 0.12s,
          border-color 0.12s;
      }

      .toggle-btn:hover {
        background: var(--wa-color-surface-lowered);
        border-color: var(--wa-color-text-quiet);
      }

      .toggle-btn wa-icon {
        font-size: 15px;
      }

      .backdrop {
        position: fixed;
        inset: 0;
        z-index: 40;
      }

      .menu {
        position: absolute;
        right: 0;
        top: calc(100% + 4px);
        z-index: 50;
        min-width: 180px;
        background: var(--wa-color-surface-raised);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        border-radius: var(--wa-border-radius-l);
        box-shadow: var(--wa-shadow-l);
        padding: var(--wa-space-xs) 0;
        animation: menu-in 0.15s ease-out;
      }

      @keyframes menu-in {
        from {
          opacity: 0;
          transform: translateY(-4px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      .menu-label {
        padding: var(--wa-space-xs) var(--wa-space-m);
        font-size: var(--wa-font-size-2xs);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-quiet);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .menu-divider {
        height: 1px;
        background: var(--wa-color-surface-border);
        margin: var(--wa-space-2xs) 0;
      }

      .menu-item {
        display: flex;
        align-items: center;
        gap: var(--wa-space-xs);
        padding: 6px var(--wa-space-m);
        font-size: var(--wa-font-size-xs);
        color: var(--wa-color-text-normal);
        cursor: pointer;
        transition: background 0.1s;
        user-select: none;
      }

      .menu-item:hover {
        background: color-mix(in srgb, var(--esphome-primary), transparent 92%);
      }

      .checkbox {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 12px;
        height: 12px;
        border-radius: 2px;
        border: 1.5px solid var(--wa-color-surface-border);
        background: transparent;
        flex-shrink: 0;
        transition:
          background 0.12s,
          border-color 0.12s;
      }

      .checkbox wa-icon {
        width: 8px;
        height: 8px;
        opacity: 0;
        transition: opacity 0.12s;
        color: var(--esphome-on-primary);
      }

      .checkbox.checked {
        background: var(--esphome-primary);
        border-color: var(--esphome-primary);
      }

      .checkbox.checked wa-icon {
        opacity: 1;
      }
    `,
  ];

  protected render() {
    return html`
      <button class="toggle-btn" @click=${this._toggle}>
        <wa-icon library="mdi" name="cog-outline"></wa-icon>
        ${this._localize("dashboard.table_columns")}
      </button>
      ${this._open
        ? html`
            <div class="backdrop" @click=${this._close}></div>
            <div class="menu">
              <div class="menu-label">${this._localize("dashboard.table_toggle_columns")}</div>
              <div class="menu-divider"></div>
              ${this.columns.map(
                (col) => html`
                  <button
                    type="button"
                    class="menu-item"
                    role="menuitemcheckbox"
                    aria-checked=${col.visible}
                    @click=${() => this._onToggle(col.id, !col.visible)}
                  >
                    <span class="checkbox ${col.visible ? "checked" : ""}">
                      <wa-icon library="mdi" name="check"></wa-icon>
                    </span>
                    ${col.header}
                  </button>
                `
              )}
            </div>
          `
        : nothing}
    `;
  }

  private _toggle() {
    this._open = !this._open;
  }

  private _close() {
    this._open = false;
  }

  private _onToggle(id: string, visible: boolean) {
    this.dispatchEvent(
      new CustomEvent("column-visibility-change", {
        detail: { id, visible },
        bubbles: true,
        composed: true,
      })
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-table-column-toggle": ESPHomeTableColumnToggle;
  }
}
