import { consume } from "@lit/context";
import {
  mdiCheck,
  mdiCog,
  mdiDotsVertical,
  mdiEyeOutline,
  mdiKeyVariant,
  mdiPlaylistCheck,
} from "@mdi/js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { JobStatus } from "../api/types.js";
import type { FirmwareJob } from "../api/types.js";
import type { LocalizeFunc } from "../common/localize.js";
import { firmwareJobsContext, localizeContext } from "../context/index.js";
import { espHomeStyles } from "../styles/shared.js";
import { EscapeController } from "../util/escape-controller.js";
import { navigate } from "../util/navigation.js";
import { registerMdiIcons } from "../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({
  check: mdiCheck,
  cog: mdiCog,
  "dots-vertical": mdiDotsVertical,
  "eye-outline": mdiEyeOutline,
  "key-variant": mdiKeyVariant,
  "playlist-check": mdiPlaylistCheck,
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
  private _open = false;

  /** Persisted "Show ignored discoveries" preference. The dashboard
   *  filters its discovered banner / grid against this flag; we own
   *  the toggle UI here so the menu sits next to other dashboard-
   *  level settings. */
  @state()
  private _showIgnored = false;

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
              <div
                class="menu-item ${this._showIgnored ? "menu-item--active" : ""}"
                role="menuitemcheckbox"
                tabindex="0"
                aria-checked=${this._showIgnored}
                @click=${this._toggleShowIgnored}
                @keydown=${this._onCheckboxKeydown}
              >
                <wa-icon library="mdi" name="eye-outline"></wa-icon>
                <span class="menu-item-label"
                  >${this._localize("layout.show_ignored_discoveries")}</span
                >
                ${this._showIgnored
                  ? html`<wa-icon
                      class="check"
                      library="mdi"
                      name="check"
                    ></wa-icon>`
                  : nothing}
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
    if (!this._open) {
      // Re-read the persisted flag on each open so a second tab's
      // change to localStorage is reflected when the user revisits
      // the menu.
      this._showIgnored = localStorage.getItem("esphome-show-ignored") === "true";
    }
    this._open = !this._open;
  }

  private _close() {
    this._open = false;
  }

  private _escape = new EscapeController(this, (e) => {
    e.preventDefault();
    this._close();
  });

  protected willUpdate(changed: Map<string, unknown>) {
    if (changed.has("_open")) this._escape.set(this._open);
  }

  private _onCheckboxKeydown = (e: KeyboardEvent) => {
    /* The toggle is a ``<div role="menuitemcheckbox">`` rather than
       a ``<button>`` so it sits visually flush with the surrounding
       menu items (the menu was built with div items predating this
       PR). The role + tabindex make it focusable and AT-readable as
       a checkable control; this handler wires Enter / Space activation
       so keyboard users get the same toggle a click would produce. */
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      this._toggleShowIgnored();
    }
  };

  private _toggleShowIgnored() {
    this._showIgnored = !this._showIgnored;
    localStorage.setItem("esphome-show-ignored", String(this._showIgnored));
    /* Dashboard listens on ``window`` for this event so we don't have
       to thread a context through the layout for a single-pref toggle. */
    window.dispatchEvent(
      new CustomEvent("esphome-show-ignored-changed", {
        detail: { value: this._showIgnored },
      }),
    );
  }

  private _openSecrets() {
    this._close();
    navigate("/secrets");
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
