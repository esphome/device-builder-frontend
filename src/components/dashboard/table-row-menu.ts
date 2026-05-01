import { consume } from "@lit/context";
import {
  mdiBroom,
  mdiCheckboxMultipleBlankOutline,
  mdiCheckDecagram,
  mdiConsole,
  mdiDelete,
  mdiDownload,
  mdiFileDownloadOutline,
  mdiKeyVariant,
  mdiOpenInNew,
  mdiPencil,
  mdiRenameOutline,
  mdiUpload,
} from "@mdi/js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { LocalizeFunc } from "../../common/localize.js";
import type { ConfiguredDevice } from "../../api/types.js";
import { localizeContext } from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import { registerMdiIcons } from "../../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({
  broom: mdiBroom,
  "checkbox-multiple-blank-outline": mdiCheckboxMultipleBlankOutline,
  "check-decagram": mdiCheckDecagram,
  console: mdiConsole,
  delete: mdiDelete,
  download: mdiDownload,
  "file-download-outline": mdiFileDownloadOutline,
  "key-variant": mdiKeyVariant,
  "open-in-new": mdiOpenInNew,
  pencil: mdiPencil,
  "rename-outline": mdiRenameOutline,
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

  @property({ type: Boolean })
  busy = false;

  @property({ attribute: false })
  position: MenuPosition | null = null;

  @property({ type: Boolean, attribute: "anchor-right" })
  anchorRight = false;

  @query(".menu")
  private _menuEl!: HTMLDivElement;

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

      /* The Visit-web-UI item renders as an <a> so the browser
         enforces rel="noopener noreferrer" instead of relying on a
         flaky window.open flag. Reset anchor defaults so it visually
         matches the surrounding <div class="menu-item"> items. */
      .menu-item--link {
        text-decoration: none;
        color: inherit;
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

      .menu-item--disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }

      .menu-item--danger {
        color: var(--esphome-error);
      }

      .menu-item--danger:hover {
        background: color-mix(in srgb, var(--esphome-error), transparent 92%);
      }

      .menu-item--danger wa-icon,
      .menu-item--danger:hover wa-icon {
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
        style=${this._initialStyle()}
      >
        <div class="menu-item" @click=${() => this._emit("edit-device")}>
          <wa-icon library="mdi" name="pencil"></wa-icon>
          ${this._localize("dashboard.drawer_edit")}
        </div>
        <div class="menu-item" @click=${() => this._emit("validate-device")}>
          <wa-icon library="mdi" name="check-decagram"></wa-icon>
          ${this._localize("dashboard.action_validate")}
        </div>
        <div class="menu-item ${this.busy ? "menu-item--disabled" : ""}" @click=${this.busy ? undefined : () => this._emit("install-device")}>
          <wa-icon library="mdi" name="upload"></wa-icon>
          ${this._localize("dashboard.action_install")}
        </div>
        <div class="menu-item ${this.busy ? "menu-item--disabled" : ""}" @click=${this.busy ? undefined : () => this._emit("open-logs")}>
          <wa-icon library="mdi" name="console"></wa-icon>
          ${this._localize("dashboard.drawer_logs")}
        </div>
        ${this._renderVisitWebUi()}
        <div class="menu-divider"></div>
        ${this.device?.api_encrypted
          ? html`<div class="menu-item" @click=${() => this._emit("show-api-key")}>
              <wa-icon library="mdi" name="key-variant"></wa-icon>
              ${this._localize("dashboard.action_show_api_key")}
            </div>`
          : nothing}
        <div class="menu-item" @click=${() => this._emit("download-yaml")}>
          <wa-icon library="mdi" name="download"></wa-icon>
          ${this._localize("dashboard.action_download_yaml")}
        </div>
        <div class="menu-item" @click=${() => this._emit("rename-device")}>
          <wa-icon library="mdi" name="rename-outline"></wa-icon>
          ${this._localize("dashboard.action_rename")}
        </div>
        <div class="menu-item" @click=${() => this._emit("clean-build")}>
          <wa-icon library="mdi" name="broom"></wa-icon>
          ${this._localize("dashboard.action_clean_build")}
        </div>
        <div class="menu-item" @click=${() => this._emit("download-elf")}>
          <wa-icon library="mdi" name="file-download-outline"></wa-icon>
          ${this._localize("dashboard.action_download_elf")}
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

  protected updated() {
    if (!this._menuEl || !this.position) return;

    const rect = this._menuEl.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pad = 8;

    let x = this.position.x;
    let y = this.position.y;
    let useRight = this.anchorRight;

    // Flip horizontally if overflowing right
    if (!useRight && x + rect.width > vw - pad) {
      useRight = true;
    }

    let style: string;
    if (useRight) {
      const right = Math.max(pad, Math.min(vw - x, vw - rect.width - pad));
      style = `right:${right}px;`;
    } else {
      const left = Math.max(pad, Math.min(x, vw - rect.width - pad));
      style = `left:${left}px;`;
    }

    // Flip vertically if overflowing bottom
    if (y + rect.height > vh - pad) {
      y = Math.max(pad, y - rect.height);
    }

    style += `top:${y}px`;
    this._menuEl.style.cssText = style;
  }

  private _initialStyle(): string {
    if (!this.position) return "";
    if (this.anchorRight) {
      return `right:${window.innerWidth - this.position.x}px;top:${this.position.y}px`;
    }
    return `left:${this.position.x}px;top:${this.position.y}px`;
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

  private _renderVisitWebUi() {
    // Render only when we actually have somewhere to send the user:
    // a port from the YAML's ``web_server:`` block AND a resolvable
    // host. ``ip`` stays empty until the device has been seen online,
    // and ``address`` should always be populated from StorageJSON,
    // but the guard means the menu item never appears as a no-op.
    if (this.device == null || this.device.web_port == null) return nothing;
    const host = this.device.address || this.device.ip;
    if (!host) return nothing;
    const port = this.device.web_port;
    const url = `http://${host}${port === 80 ? "" : `:${port}`}`;
    // Anchor element with ``rel="noopener noreferrer"`` is the
    // codebase's standard external-link pattern; the browser enforces
    // the security defaults instead of relying on
    // ``window.open(..., "noopener")`` which doesn't suppress the
    // Referer header and isn't honoured uniformly across browsers.
    return html`
      <a
        class="menu-item menu-item--link"
        href=${url}
        target="_blank"
        rel="noopener noreferrer"
        @click=${this._close}
      >
        <wa-icon library="mdi" name="open-in-new"></wa-icon>
        ${this._localize("dashboard.action_visit_web_ui")}
      </a>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-table-row-menu": ESPHomeTableRowMenu;
  }
}
