import { consume } from "@lit/context";
import { mdiCheck, mdiChevronDown } from "@mdi/js";
import { css, html, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";

import type { LocalizeFunc } from "../../common/localize.js";
import { OverflowMenuElement } from "../../components/overflow-menu-element.js";
import { localizeContext } from "../../context/index.js";
import { dropdownMenuStyles } from "../../styles/dropdown-menu.js";
import { espHomeStyles } from "../../styles/shared.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { DEFAULT_WEB_MODE, WEB_PLATFORMS } from "../platforms/registry.js";
import type { WebMode } from "../web-mode.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({ check: mdiCheck, "chevron-down": mdiChevronDown });

/**
 * The header's device-family picker: the current family on a pill, the rest
 * in a dropdown, so every family keeps its name at any width. Picking one
 * fires ``set-mode`` with it.
 */
@customElement("esphome-web-mode-picker")
export class ESPHomeWebModePicker extends OverflowMenuElement {
  @property() mode: WebMode = DEFAULT_WEB_MODE;

  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @query(".trigger") private _trigger!: HTMLButtonElement;

  /** Where the menu opens: under the trigger, right edges aligned. */
  private _menuPos = { top: 0, right: 0 };

  override connectedCallback() {
    super.connectedCallback();
    window.addEventListener("resize", this._onResize);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("resize", this._onResize);
  }

  // The menu is placed at open time, and a resize can hide this picker; close it.
  private _onResize = () => this._close();

  private _openMenu = () => {
    const rect = this._trigger.getBoundingClientRect();
    this._menuPos = { top: rect.bottom + 4, right: window.innerWidth - rect.right };
    this._toggle();
  };

  private _pick(mode: WebMode) {
    this._close();
    if (mode !== this.mode) this._emit("set-mode", mode);
  }

  private _onMenuKeydown = (e: KeyboardEvent) => {
    if (e.key === "Tab") {
      // Like Escape: leave the menu back on its trigger rather than past an open menu.
      e.preventDefault();
      this._close();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const rows = [...this.renderRoot.querySelectorAll<HTMLElement>(".menu-item")];
    const at = rows.indexOf(e.target as HTMLElement);
    const step = e.key === "ArrowDown" ? 1 : -1;
    rows[(at + step + rows.length) % rows.length]?.focus();
  };

  protected updated(changed: Map<string, unknown>) {
    // Open on the current family, so the arrows start from it; close back on the trigger.
    if (!changed.has("_open")) return;
    if (this._open) {
      this.renderRoot.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    } else if (changed.get("_open") === true) {
      this._trigger.focus();
    }
  }

  protected render() {
    const current = WEB_PLATFORMS.find((p) => p.mode === this.mode) ?? WEB_PLATFORMS[0];
    const currentLabel = this._localize(current.labelKey);
    const pickerLabel = this._localize("web.header.mode_picker_label");
    return html`
      <button
        type="button"
        class="trigger"
        aria-haspopup="menu"
        aria-expanded=${this._open}
        aria-label="${pickerLabel}: ${currentLabel}"
        @click=${this._openMenu}
      >
        <img class="logo" src="/static/logo/${current.logo}" alt="" />
        <span class="label">${currentLabel}</span>
        <wa-icon library="mdi" name="chevron-down"></wa-icon>
      </button>
      ${
        this._open
          ? html`
              <div class="backdrop" @click=${this._close}></div>
              <div
                class="menu"
                role="menu"
                aria-label=${pickerLabel}
                style="top:${this._menuPos.top}px;right:${this._menuPos.right}px;"
                @keydown=${this._onMenuKeydown}
              >
                ${WEB_PLATFORMS.map(({ mode, logo, labelKey }) => {
                  const active = mode === this.mode;
                  return html`
                    <div
                      class="menu-item"
                      role="menuitemradio"
                      aria-checked=${active}
                      tabindex="-1"
                      @click=${() => this._pick(mode)}
                      @keydown=${this._onItemKeydown}
                    >
                      <img class="logo" src="/static/logo/${logo}" alt="" />
                      <span class="menu-item-label">${this._localize(labelKey)}</span>
                      ${active ? html`<wa-icon library="mdi" name="check"></wa-icon>` : nothing}
                    </div>
                  `;
                })}
              </div>
            `
          : nothing
      }
    `;
  }

  static styles = [
    espHomeStyles,
    dropdownMenuStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }

      .trigger {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        max-width: 100%;
        padding: 4px 8px 4px 10px;
        background: none;
        border: 1px solid color-mix(in srgb, var(--esphome-on-primary), transparent 55%);
        border-radius: var(--wa-border-radius-m);
        color: var(--esphome-on-primary);
        font-size: var(--wa-font-size-xs);
        font-weight: var(--wa-font-weight-semibold);
        font-family: inherit;
        cursor: pointer;
        transition: background 0.1s;
      }

      .trigger:hover,
      .trigger[aria-expanded="true"] {
        background: color-mix(in srgb, var(--esphome-on-primary), transparent 85%);
      }

      .logo {
        height: 16px;
        flex-shrink: 0;
      }

      .label {
        min-width: 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .menu {
        min-width: 180px;
      }

      .menu-item[aria-checked="true"] {
        font-weight: var(--wa-font-weight-semibold);
      }

      .menu-item-label {
        flex: 1;
      }

      .menu-item wa-icon {
        color: var(--esphome-primary);
      }

      /* The mode logos are drawn for the primary header; give them contrast on the menu.
         A fixed-width chip keeps the labels aligned across logos of different widths. */
      .menu .logo {
        box-sizing: border-box;
        width: 32px;
        height: 20px;
        padding: 2px 4px;
        object-fit: contain;
        border-radius: var(--wa-border-radius-s);
        background: var(--esphome-primary);
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-web-mode-picker": ESPHomeWebModePicker;
  }
}
