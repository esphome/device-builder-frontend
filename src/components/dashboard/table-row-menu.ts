import { consume } from "@lit/context";
import {
  mdiCheckboxMultipleBlankOutline,
  mdiConsole,
  mdiDelete,
  mdiPencil,
  mdiUpload,
} from "@mdi/js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { LocalizeFunc } from "../../common/localize.js";
import type { ConfiguredDevice } from "../../api/types.js";
import { localizeContext } from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import { registerMdiIcons } from "../../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({
  "checkbox-multiple-blank-outline": mdiCheckboxMultipleBlankOutline,
  console: mdiConsole,
  delete: mdiDelete,
  pencil: mdiPencil,
  upload: mdiUpload,
});

interface MenuPosition {
  x: number;
  y: number;
}

@customElement("esphome-table-row-menu")
export class ESPHomeTableRowMenu extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @property({ attribute: false })
  device: ConfiguredDevice | null = null;

  @property({ attribute: false })
  position: MenuPosition | null = null;

  @property({ type: Boolean, attribute: "anchor-right" })
  anchorRight = false;

  static styles = [
    espHomeStyles,
    css`
      :host {
        display: block;
      }

      .backdrop {
        position: fixed;
        inset: 0;
        z-index: 100;
      }

      .menu {
        position: fixed;
        z-index: 101;
        min-width: 170px;
        background: var(--wa-color-surface-raised);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        border-radius: var(--wa-border-radius-l);
        box-shadow: var(--wa-shadow-l);
        padding: var(--wa-space-xs) 0;
        animation: menu-in 0.12s ease-out;
      }

      @keyframes menu-in {
        from {
          opacity: 0;
          transform: scale(0.95);
        }
        to {
          opacity: 1;
          transform: scale(1);
        }
      }

      .menu-item {
        display: flex;
        align-items: center;
        gap: var(--wa-space-s);
        padding: 8px var(--wa-space-m);
        font-size: var(--wa-font-size-xs);
        color: var(--wa-color-text-normal);
        cursor: pointer;
        transition: background 0.1s;
        user-select: none;
      }

      .menu-item:hover {
        background: color-mix(in srgb, var(--esphome-primary), transparent 92%);
      }

      .menu-item wa-icon {
        font-size: 16px;
        color: var(--wa-color-text-quiet);
      }

      .menu-item:hover wa-icon {
        color: var(--esphome-primary);
      }

      .menu-divider {
        height: 1px;
        background: var(--wa-color-surface-border);
        margin: var(--wa-space-2xs) 0;
      }

      .menu-item--danger {
        color: var(--esphome-error);
      }

      .menu-item--danger wa-icon {
        color: var(--esphome-error);
      }
    `,
  ];

  protected render() {
    if (!this.device || !this.position) return nothing;

    return html`
      <div class="backdrop" @click=${this._close} @contextmenu=${this._preventAndClose}></div>
      <div
        class="menu"
        style="${this.anchorRight ? "right" : "left"}:${this.anchorRight ? window.innerWidth - this.position.x : this.position.x}px;top:${this.position.y}px"
      >
        <div class="menu-item" @click=${() => this._emit("edit-device")}>
          <wa-icon library="mdi" name="pencil"></wa-icon>
          ${this._localize("dashboard.drawer_edit")}
        </div>
        <div class="menu-item" @click=${() => this._emit("update-device")}>
          <wa-icon library="mdi" name="upload"></wa-icon>
          ${this._localize("dashboard.drawer_update")}
        </div>
        <div class="menu-item" @click=${() => this._emit("open-logs")}>
          <wa-icon library="mdi" name="console"></wa-icon>
          ${this._localize("dashboard.drawer_logs")}
        </div>
        <div class="menu-divider"></div>
        <div class="menu-item" @click=${() => this._emit("enter-select")}>
          <wa-icon library="mdi" name="checkbox-multiple-blank-outline"></wa-icon>
          ${this._localize("dashboard.context_select")}
        </div>
        <div class="menu-divider"></div>
        <div class="menu-item menu-item--danger" @click=${() => this._emit("delete-device")}>
          <wa-icon library="mdi" name="delete"></wa-icon>
          ${this._localize("dashboard.delete")}
        </div>
      </div>
    `;
  }

  private _close() {
    this.device = null;
    this.position = null;
    this.dispatchEvent(
      new CustomEvent("menu-close", { bubbles: true, composed: true }),
    );
  }

  private _preventAndClose(e: Event) {
    e.preventDefault();
    this._close();
  }

  private _emit(name: string) {
    this.dispatchEvent(
      new CustomEvent(name, {
        detail: this.device,
        bubbles: true,
        composed: true,
      }),
    );
    this._close();
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-table-row-menu": ESPHomeTableRowMenu;
  }
}
