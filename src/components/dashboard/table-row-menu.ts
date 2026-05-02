import { consume } from "@lit/context";
import {
  mdiBroom,
  mdiCheckboxMultipleBlankOutline,
  mdiCheckDecagram,
  mdiConsole,
  mdiDelete,
  mdiDownload,
  mdiFileDownloadOutline,
  mdiIpNetworkOutline,
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
import { EscapeController } from "../../util/escape-controller.js";
import { buildWebUiUrl } from "../../util/web-ui-url.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({
  broom: mdiBroom,
  "checkbox-multiple-blank-outline": mdiCheckboxMultipleBlankOutline,
  "check-decagram": mdiCheckDecagram,
  console: mdiConsole,
  delete: mdiDelete,
  download: mdiDownload,
  "file-download-outline": mdiFileDownloadOutline,
  "ip-network-outline": mdiIpNetworkOutline,
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

  /** When true, the menu is being shown for a card view where every
   *  inline action button is always rendered. The duplicate menu items
   *  (Logs, Visit Web UI, Install when pending) are hidden via CSS
   *  so the kebab only carries what isn't already on the card. The
   *  host attribute drives the CSS selector — keep it in sync. */
  @property({ type: Boolean, attribute: "card-mode", reflect: true })
  cardMode = false;

  /** Mirrors ``ConfiguredDevice.has_pending_changes`` for the open
   *  device. The inline Install button only renders when this is true,
   *  so the kebab Install entry hides at the same widths to avoid the
   *  duplicate. Reflected so CSS can target it via host attribute. */
  @property({ type: Boolean, attribute: "has-pending", reflect: true })
  hasPending = false;

  /** Mirrors ``ConfiguredDevice.update_available`` for the open
   *  device. The inline Update button takes precedence over Install
   *  when this is true; the kebab's Install entry hides for the same
   *  reason as ``hasPending``. */
  @property({ type: Boolean, attribute: "has-update", reflect: true })
  hasUpdate = false;

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

      /* Dedupe with the inline action buttons. The card always shows
         every inline action when applicable, so card-mode hides the
         duplicate kebab entries unconditionally. The table only shows
         the inline buttons above each priority breakpoint, so for the
         table the kebab entries hide only above those same widths.
         Class names match the inline cell-action-btn modifiers so the
         pairing is obvious at a glance; breakpoints are off-by-one
         from the inline rules so the transition pixel never has both
         copies hidden:
           menu-item--install  (only when has-pending)  inline > 820px
           menu-item--logs                              inline > 920px
           menu-item--visit-web                         inline > 1024px */
      :host([card-mode]) .menu-item--logs,
      :host([card-mode]) .menu-item--visit-web,
      :host([card-mode][has-pending]) .menu-item--install,
      :host([card-mode][has-update]) .menu-item--install {
        display: none;
      }
      @media (min-width: 821px) {
        :host(:not([card-mode])[has-pending]) .menu-item--install,
        :host(:not([card-mode])[has-update]) .menu-item--install {
          display: none;
        }
      }
      @media (min-width: 921px) {
        :host(:not([card-mode])) .menu-item--logs {
          display: none;
        }
      }
      @media (min-width: 1025px) {
        :host(:not([card-mode])) .menu-item--visit-web {
          display: none;
        }
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
        <div class="menu-item" @click=${() => this._emit("validate-device")}>
          <wa-icon library="mdi" name="check-decagram"></wa-icon>
          ${this._localize("dashboard.action_validate")}
        </div>
        ${this.hasUpdate
          ? html`<div
              class="menu-item menu-item--install ${this.busy ? "menu-item--disabled" : ""}"
              @click=${this.busy ? undefined : () => this._emit("update-device")}
            >
              <wa-icon library="mdi" name="upload"></wa-icon>
              ${this._localize("dashboard.update")}
            </div>`
          : html`<div
              class="menu-item menu-item--install ${this.busy ? "menu-item--disabled" : ""}"
              @click=${this.busy ? undefined : () => this._emit("install-device")}
            >
              <wa-icon library="mdi" name="upload"></wa-icon>
              ${this._localize("dashboard.action_install")}
            </div>`}
        <div class="menu-item menu-item--logs" @click=${() => this._emit("open-logs")}>
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
        <div
          class="menu-item ${this.busy ? "menu-item--disabled" : ""}"
          @click=${this.busy ? undefined : () => this._emit("rename-device")}
        >
          <wa-icon library="mdi" name="rename-outline"></wa-icon>
          ${this._localize("dashboard.action_rename")}
        </div>
        ${this.device?.loaded_integrations?.includes("api")
          ? html`<div
              class="menu-item ${this.busy ? "menu-item--disabled" : ""}"
              @click=${this.busy ? undefined : () => this._emit("install-to-address")}
            >
              <wa-icon library="mdi" name="ip-network-outline"></wa-icon>
              ${this._localize("dashboard.action_install_to_address")}
            </div>`
          : nothing}
        <div
          class="menu-item ${this.busy ? "menu-item--disabled" : ""}"
          @click=${this.busy ? undefined : () => this._emit("clean-build")}
        >
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
        <div
          class="menu-item menu-item--danger ${this.busy ? "menu-item--disabled" : ""}"
          @click=${this.busy ? undefined : () => this._emit("delete-device")}
        >
          <wa-icon library="mdi" name="delete"></wa-icon>
          ${this._localize("dashboard.delete")}
        </div>
      </div>
    `;
  }

  private _escape = new EscapeController(this, (e) => {
    e.preventDefault();
    this._close();
  });

  protected willUpdate(changed: Map<string, unknown>) {
    if (changed.has("device") || changed.has("position")) {
      this._escape.set(this.device != null && this.position != null);
    }
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
    // Render only when we actually have somewhere to send the user.
    // ``buildWebUiUrl`` is the single source of truth for the
    // host/port/protocol logic; it returns "" when the YAML didn't
    // expose web_server or we don't have a host yet.
    if (this.device == null) return nothing;
    const url = buildWebUiUrl(this.device);
    if (!url) return nothing;
    // Anchor element with ``rel="noopener noreferrer"`` is the
    // codebase's standard external-link pattern; the browser enforces
    // the security defaults instead of relying on
    // ``window.open(..., "noopener")`` which doesn't suppress the
    // Referer header and isn't honoured uniformly across browsers.
    return html`
      <a
        class="menu-item menu-item--link menu-item--visit-web"
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
