import { consume } from "@lit/context";
import { mdiClose, mdiConsole, mdiPencil, mdiUpload, mdiWifi, mdiWifiOff } from "@mdi/js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { LocalizeFunc } from "../../common/localize.js";
import type { ConfiguredDevice } from "../../api/types.js";
import { deviceStatesContext, localizeContext } from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import { registerMdiIcons } from "../../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "./device-drawer-content.js";

registerMdiIcons({
  close: mdiClose,
  console: mdiConsole,
  pencil: mdiPencil,
  upload: mdiUpload,
  wifi: mdiWifi,
  "wifi-off": mdiWifiOff,
});

@customElement("esphome-device-drawer")
export class ESPHomeDeviceDrawer extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: deviceStatesContext, subscribe: true })
  @state()
  private _deviceStates: Record<string, boolean> = {};

  @property({ type: Boolean, reflect: true })
  open = false;

  @property({ attribute: false })
  device: ConfiguredDevice | null = null;

  static styles = [
    espHomeStyles,
    css`
      :host {
        display: block;
      }

      /* ─── Overlay ─── */

      .backdrop {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.35);
        z-index: 998;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.25s ease;
      }

      :host([open]) .backdrop {
        opacity: 1;
        pointer-events: auto;
      }

      /* ─── Panel ─── */

      .drawer {
        position: fixed;
        top: 0;
        right: 0;
        bottom: 0;
        width: 420px;
        max-width: 92vw;
        z-index: 999;
        background: var(--wa-color-surface-default);
        box-shadow: -8px 0 30px rgba(0, 0, 0, 0.15);
        display: flex;
        flex-direction: column;
        transform: translateX(100%);
        transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        overflow: hidden;
      }

      :host([open]) .drawer {
        transform: translateX(0);
      }

      /* ─── Header ─── */

      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--wa-space-l);
        border-bottom: var(--wa-border-width-s) solid
          var(--wa-color-surface-border);
        flex-shrink: 0;
      }

      .header-left {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 0;
        flex: 1;
      }

      .title {
        margin: 0;
        font-size: var(--wa-font-size-l);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-normal);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .subtitle {
        margin: 0;
        font-size: var(--wa-font-size-xs);
        color: var(--wa-color-text-quiet);
        font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas,
          monospace;
      }

      .close-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 34px;
        height: 34px;
        border-radius: var(--wa-border-radius-m);
        border: none;
        background: transparent;
        color: var(--wa-color-text-quiet);
        cursor: pointer;
        transition: background 0.12s, color 0.12s;
        flex-shrink: 0;
        margin-left: var(--wa-space-s);
      }

      .close-btn:hover {
        background: var(--wa-color-surface-lowered);
        color: var(--wa-color-text-normal);
      }

      .close-btn wa-icon {
        font-size: 20px;
      }

      /* ─── Status Banner ─── */

      .status-banner {
        display: flex;
        align-items: center;
        gap: var(--wa-space-s);
        padding: var(--wa-space-m) var(--wa-space-l);
        margin: var(--wa-space-m) var(--wa-space-l) 0;
        border-radius: var(--wa-border-radius-l);
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
      }

      .status-banner.online {
        background: color-mix(
          in srgb,
          var(--esphome-success),
          transparent 88%
        );
        color: var(--esphome-success);
        border: var(--wa-border-width-s) solid
          color-mix(in srgb, var(--esphome-success), transparent 70%);
      }

      .status-banner.offline {
        background: color-mix(in srgb, var(--esphome-error), transparent 88%);
        color: var(--esphome-error);
        border: var(--wa-border-width-s) solid
          color-mix(in srgb, var(--esphome-error), transparent 70%);
      }

      .status-banner wa-icon {
        font-size: 20px;
      }

      .status-dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        flex-shrink: 0;
      }

      .status-dot.online {
        background: var(--esphome-success);
        box-shadow: 0 0 8px
          color-mix(in srgb, var(--esphome-success), transparent 40%);
      }

      .status-dot.offline {
        background: var(--esphome-error);
        box-shadow: 0 0 8px
          color-mix(in srgb, var(--esphome-error), transparent 50%);
      }

      /* ─── Body ─── */

      .body {
        flex: 1;
        overflow-y: auto;
        padding: var(--wa-space-l);
      }

      /* ─── Footer ─── */

      .footer {
        display: flex;
        gap: var(--wa-space-xs);
        padding: var(--wa-space-m) var(--wa-space-l);
        border-top: var(--wa-border-width-s) solid
          var(--wa-color-surface-border);
        flex-shrink: 0;
      }

      .action {
        flex: 1;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 9px 14px;
        border-radius: var(--wa-border-radius-m);
        font-size: var(--wa-font-size-xs);
        font-weight: var(--wa-font-weight-bold);
        font-family: inherit;
        cursor: pointer;
        border: var(--wa-border-width-s) solid transparent;
        transition: background 0.12s, border-color 0.12s;
        white-space: nowrap;
      }

      .action wa-icon {
        font-size: 16px;
      }

      .action--primary {
        background: var(--esphome-primary);
        color: var(--esphome-on-primary);
      }
      .action--primary:hover {
        background: color-mix(in srgb, var(--esphome-primary), black 10%);
      }

      .action--accent {
        background: color-mix(
          in srgb,
          var(--esphome-primary),
          transparent 90%
        );
        color: var(--esphome-primary);
        border-color: color-mix(
          in srgb,
          var(--esphome-primary),
          transparent 70%
        );
      }
      .action--accent:hover {
        background: color-mix(
          in srgb,
          var(--esphome-primary),
          transparent 82%
        );
        border-color: var(--esphome-primary);
      }

      .action--ghost {
        background: transparent;
        color: var(--wa-color-text-normal);
        border-color: var(--wa-color-surface-border);
      }
      .action--ghost:hover {
        background: var(--wa-color-surface-lowered);
        border-color: var(--wa-color-text-quiet);
      }
    `,
  ];

  protected render() {
    const device = this.device;
    if (!device) return nothing;

    const online = this._deviceStates[device.configuration] ?? false;

    return html`
      <div class="backdrop" @click=${this._close}></div>
      <div class="drawer">
        <div class="header">
          <div class="header-left">
            <h2 class="title">${device.friendly_name || device.name}</h2>
            <p class="subtitle">${device.configuration}</p>
          </div>
          <button class="close-btn" @click=${this._close} aria-label=${this._localize("dashboard.drawer_close")}>
            <wa-icon library="mdi" name="close"></wa-icon>
          </button>
        </div>

        <div class="status-banner ${online ? "online" : "offline"}">
          <span class="status-dot ${online ? "online" : "offline"}"></span>
          <wa-icon
            library="mdi"
            name=${online ? "wifi" : "wifi-off"}
          ></wa-icon>
          ${online ? this._localize("dashboard.drawer_device_online") : this._localize("dashboard.drawer_device_offline")}
        </div>

        <div class="body">
          <esphome-device-drawer-content
            .device=${device}
          ></esphome-device-drawer-content>
        </div>

        <div class="footer">
          <button
            class="action action--primary"
            @click=${() => this._emitAction("edit-device")}
          >
            <wa-icon library="mdi" name="pencil"></wa-icon>
            ${this._localize("dashboard.drawer_edit")}
          </button>
          <button
            class="action action--accent"
            @click=${() => this._emitAction("update-device")}
          >
            <wa-icon library="mdi" name="upload"></wa-icon>
            ${this._localize("dashboard.drawer_update")}
          </button>
          <button
            class="action action--ghost"
            @click=${() => this._emitAction("open-logs")}
          >
            <wa-icon library="mdi" name="console"></wa-icon>
            ${this._localize("dashboard.drawer_logs")}
          </button>
        </div>
      </div>
    `;
  }

  private _close() {
    this.open = false;
    this.dispatchEvent(
      new CustomEvent("drawer-close", { bubbles: true, composed: true }),
    );
  }

  private _emitAction(name: string) {
    this.dispatchEvent(
      new CustomEvent(name, {
        detail: this.device,
        bubbles: true,
        composed: true,
      }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-device-drawer": ESPHomeDeviceDrawer;
  }
}
