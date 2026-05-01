import { consume } from "@lit/context";
import {
  mdiCog,
  mdiDotsVertical,
  mdiKeyVariant,
  mdiPlaylistCheck,
  mdiUpdate,
} from "@mdi/js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { JobStatus } from "../api/types.js";
import type { FirmwareJob } from "../api/types.js";
import type { LocalizeFunc } from "../common/localize.js";
import { firmwareJobsContext, localizeContext } from "../context/index.js";
import { espHomeStyles } from "../styles/shared.js";
import { navigate } from "../util/navigation.js";
import { registerMdiIcons } from "../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({
  cog: mdiCog,
  "dots-vertical": mdiDotsVertical,
  "key-variant": mdiKeyVariant,
  "playlist-check": mdiPlaylistCheck,
  update: mdiUpdate,
});

@customElement("esphome-header-actions")
export class ESPHomeHeaderActions extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: firmwareJobsContext, subscribe: true })
  @state()
  private _jobs: Map<string, FirmwareJob> = new Map();

  @state()
  private _path = window.location.pathname;

  @state()
  private _open = false;

  private _onPopState = () => {
    this._path = window.location.pathname;
  };

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("popstate", this._onPopState);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("popstate", this._onPopState);
  }

  static styles = [
    espHomeStyles,
    css`
      :host {
        display: contents;
      }

      .menu-btn {
        position: relative;
        display: inline-flex;
        align-items: center;
        border: none;
        background: none;
        color: var(--esphome-on-primary);
        cursor: pointer;
        padding: 6px;
        border-radius: var(--wa-border-radius-m);
        opacity: 0.85;
        transition: opacity 0.12s, background 0.12s;
      }

      .menu-btn:hover {
        opacity: 1;
        background: color-mix(in srgb, var(--esphome-on-primary), transparent 85%);
      }

      .menu-btn wa-icon {
        font-size: 20px;
      }

      .menu-btn-badge {
        position: absolute;
        top: 4px;
        right: 4px;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--esphome-warning, #f59e0b);
        box-shadow: 0 0 0 2px var(--esphome-primary);
      }

      .backdrop {
        position: fixed;
        inset: 0;
        z-index: 100;
      }

      .menu {
        position: fixed;
        z-index: 101;
        min-width: 220px;
        background: var(--wa-color-surface-raised);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        border-radius: var(--wa-border-radius-l);
        box-shadow: var(--wa-shadow-l);
        padding: var(--wa-space-xs) 0;
        animation: menu-in 0.12s ease-out;
      }

      @keyframes menu-in {
        from { opacity: 0; transform: scale(0.95); }
        to { opacity: 1; transform: scale(1); }
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

      .menu-item--active wa-icon {
        color: var(--esphome-primary);
      }

      .menu-item-label {
        flex: 1;
      }

      .menu-item .check {
        font-size: 14px;
        color: var(--esphome-primary);
      }

      .menu-item-count {
        margin-left: auto;
        font-size: var(--wa-font-size-2xs);
        font-weight: var(--wa-font-weight-bold);
        color: var(--esphome-on-primary);
        background: var(--esphome-primary);
        border-radius: 999px;
        padding: 1px 8px;
        min-width: 18px;
        text-align: center;
      }

      .menu-divider {
        height: 1px;
        background: var(--wa-color-surface-border);
        margin: var(--wa-space-2xs) 0;
      }

      .menu-label {
        padding: var(--wa-space-2xs) var(--wa-space-m);
        font-size: var(--wa-font-size-2xs);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-quiet);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
    `,
  ];

  protected render() {
    let activeCount = 0;
    for (const job of this._jobs.values()) {
      if (job.status === JobStatus.QUEUED || job.status === JobStatus.RUNNING) {
        activeCount++;
      }
    }
    return html`
      <button class="menu-btn" @click=${this._toggle}>
        <wa-icon library="mdi" name="dots-vertical"></wa-icon>
        ${activeCount > 0
          ? html`<span class="menu-btn-badge" aria-label=${this._localize("firmware_jobs.badge_label", { count: activeCount })}></span>`
          : nothing}
      </button>
      ${this._open
        ? html`
            <div class="backdrop" @click=${this._close}></div>
            <div class="menu" style="position:fixed;top:var(--esphome-header-height, 48px);right:var(--wa-space-s);">
              ${this._path === "/"
                ? html`
                    <div class="menu-item" @click=${this._openUpdateAll}>
                      <wa-icon library="mdi" name="update"></wa-icon>
                      ${this._localize("layout.update_all")}
                    </div>
                  `
                : nothing}
              <div class="menu-item" @click=${this._openFirmwareJobs}>
                <wa-icon library="mdi" name="playlist-check"></wa-icon>
                <span class="menu-item-label">${this._localize("firmware_jobs.menu_item")}</span>
                ${activeCount > 0
                  ? html`<span class="menu-item-count">${activeCount}</span>`
                  : nothing}
              </div>
              <div class="menu-item" @click=${this._openSecrets}>
                <wa-icon library="mdi" name="key-variant"></wa-icon>
                ${this._localize("layout.secrets")}
              </div>
              <div class="menu-divider"></div>
              <div class="menu-item" @click=${this._openSettings}>
                <wa-icon library="mdi" name="cog"></wa-icon>
                ${this._localize("layout.settings")}
              </div>
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

  private _openSecrets() {
    this._close();
    navigate("/secrets");
  }

  private _openUpdateAll() {
    this._close();
    window.dispatchEvent(new CustomEvent("esphome-enter-select-mode"));
  }

  private _openFirmwareJobs() {
    this._close();
    this.dispatchEvent(
      new CustomEvent("open-firmware-jobs", {
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _openSettings() {
    this._close();
    this.dispatchEvent(
      new CustomEvent("open-settings", {
        bubbles: true,
        composed: true,
      }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-header-actions": ESPHomeHeaderActions;
  }
}
