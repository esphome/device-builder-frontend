import { consume } from "@lit/context";
import { mdiCheck, mdiCogOutline } from "@mdi/js";
import { css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { localizeContext } from "../../context/index.js";
import { dropdownMenuStyles } from "../../styles/dropdown-menu.js";
import { espHomeStyles } from "../../styles/shared.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { OverflowMenuElement } from "../overflow-menu-element.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({ check: mdiCheck, "cog-outline": mdiCogOutline });

export interface ToggleableColumn {
  id: string;
  header: string;
  visible: boolean;
}

@customElement("esphome-table-column-toggle")
export class ESPHomeTableColumnToggle extends OverflowMenuElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @property({ attribute: false })
  columns: ToggleableColumn[] = [];

  static styles = [
    espHomeStyles,
    dropdownMenuStyles,
    css`
      :host {
        display: block;
        position: relative;
        /* Allow the toggle to shrink (and its label to ellipsize) when
           it shares the mobile toolbar row with Filters + Create. */
        min-width: 0;
      }

      .toggle-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 0 14px;
        height: 36px;
        max-width: 100%;
        min-width: 0;
        box-sizing: border-box;
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
        flex-shrink: 0;
      }

      /* On mobile the Columns toggle shares one row with Filters and
         Create device (see table-styles.ts). The label ellipsizes
         rather than wrapping the row when space is tight (e.g. a long
         translated "Columns" string); the icon stays put. */
      .toggle-btn .label {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        /* Flex item must allow shrinking below its intrinsic width or
           the ellipsis never triggers on a tight toolbar row. */
        min-width: 0;
      }

      /* Tighter horizontal padding on the mobile toolbar row so the
         three controls sit more compactly (matches Create device). */
      @media (max-width: 700px) {
        .toggle-btn {
          padding: 0 10px;
        }
      }

      /* Base popover chrome comes from the shared dropdownMenuStyles
         fragment; the rules below are this component's deltas and win
         because this block sits after the shared one in the styles
         array. This toggle's popover sits below the app dialogs, so
         its layers use lower z-indexes than the shared 100/101. */
      .backdrop {
        z-index: 40;
      }

      .menu {
        /* Anchored to the toggle button rather than the viewport. */
        position: absolute;
        right: 0;
        top: calc(100% + 4px);
        z-index: 50;
        min-width: 180px;
        animation: menu-in 0.15s ease-out;
      }

      /* At desktop widths the toggle sits at the right edge of the
         controls row, so the menu (right:0) opens leftward and fits.
         On mobile the toggle moves into the middle of the second
         toolbar row (see table-styles.ts), where right:0 would push
         the menu off the left edge of the viewport. Anchor it to the
         toggle's left edge so it opens rightward into open space.
         700px matches the breakpoint where the controls reflow. */
      @media (max-width: 700px) {
        .menu {
          left: 0;
          right: auto;
        }
      }

      /* Redefines the shared menu-in on purpose: this menu slides down
         from its anchor instead of scaling in. The last @keyframes
         definition with a given name wins, and this block comes after
         dropdownMenuStyles in the styles array. */
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

      /* Tighter rows than the shared .menu-item: these are compact
         checkbox rows, not icon-labelled actions. */
      .menu-item {
        gap: var(--wa-space-xs);
        padding: 6px var(--wa-space-m);
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
      <button
        class="toggle-btn"
        type="button"
        aria-label=${this._localize("dashboard.table_columns")}
        aria-haspopup="true"
        aria-expanded=${this._open}
        @click=${this._toggle}
      >
        <wa-icon library="mdi" name="cog-outline"></wa-icon>
        <span class="label">${this._localize("dashboard.table_columns")}</span>
      </button>
      ${
        this._open
          ? html`
              <div class="backdrop" @click=${this._close}></div>
              <div class="menu">
                <div class="menu-label">
                  ${this._localize("dashboard.table_toggle_columns")}
                </div>
                <div class="menu-divider"></div>
                ${this.columns.map(
                  (col) => html`
                    <div
                      class="menu-item"
                      role="menuitemcheckbox"
                      aria-checked=${col.visible}
                      tabindex="0"
                      @click=${() => this._onToggle(col.id, !col.visible)}
                      @keydown=${this._onItemKeydown}
                    >
                      <span class="checkbox ${col.visible ? "checked" : ""}">
                        <wa-icon library="mdi" name="check"></wa-icon>
                      </span>
                      ${col.header}
                    </div>
                  `
                )}
              </div>
            `
          : nothing
      }
    `;
  }

  private _onToggle(id: string, visible: boolean) {
    this._emit("column-visibility-change", { id, visible });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-table-column-toggle": ESPHomeTableColumnToggle;
  }
}
