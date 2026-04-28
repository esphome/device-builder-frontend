import { consume } from "@lit/context";
import { mdiArrowLeft, mdiSerialPort, mdiUsb, mdiWifi } from "@mdi/js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { ESPHomeAPI } from "../api/index.js";
import { DeviceState } from "../api/types.js";
import type { SerialPort } from "../api/types.js";
import type { LocalizeFunc } from "../common/localize.js";
import { apiContext, localizeContext } from "../context/index.js";
import { espHomeStyles } from "../styles/shared.js";
import { registerMdiIcons } from "../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/dialog/dialog.js";
import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/spinner/spinner.js";

registerMdiIcons({
  "arrow-left": mdiArrowLeft,
  wifi: mdiWifi,
  usb: mdiUsb,
  "serial-port": mdiSerialPort,
});

type DialogView = "method" | "port-select";

@customElement("esphome-install-method-dialog")
export class ESPHomeInstallMethodDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: apiContext })
  private _api!: ESPHomeAPI;

  @property({ type: Boolean })
  open = false;

  @property()
  deviceState: DeviceState = DeviceState.UNKNOWN;

  @property()
  mode: "install" | "logs" = "install";

  @state() private _view: DialogView = "method";
  @state() private _ports: SerialPort[] = [];
  @state() private _loadingPorts = false;

  private get _supportsWebSerial(): boolean {
    return "serial" in navigator;
  }

  protected willUpdate(changed: Map<string, unknown>) {
    // Reset to method view when dialog opens
    if (changed.has("open") && this.open) {
      this._view = "method";
      this._ports = [];
    }
  }

  static styles = [
    espHomeStyles,
    css`
      wa-dialog {
        --width: 460px;
      }

      wa-dialog::part(header) {
        background: var(--esphome-primary);
        padding: 0 var(--wa-space-m);
        height: 40px;
        box-sizing: border-box;
      }

      wa-dialog::part(title) {
        color: var(--esphome-on-primary);
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
      }

      wa-dialog::part(close-button__base) {
        background: transparent;
        border: none;
        box-shadow: none;
        padding: 0;
        min-width: unset;
        min-height: unset;
        color: var(--esphome-on-primary);
        cursor: pointer;
      }

      wa-dialog::part(body) {
        padding: var(--wa-space-l);
      }

      wa-dialog::part(footer) {
        display: none;
      }

      .list {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-s);
      }

      .option {
        display: flex;
        align-items: center;
        gap: var(--wa-space-m);
        padding: var(--wa-space-m);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        border-radius: var(--wa-border-radius-l);
        cursor: pointer;
        transition:
          background 0.12s,
          border-color 0.12s;
      }

      .option:hover:not(.option--disabled) {
        background: color-mix(in srgb, var(--esphome-primary), transparent 92%);
        border-color: var(--esphome-primary);
      }

      .option--disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }

      .option wa-icon {
        font-size: 28px;
        color: var(--esphome-primary);
        flex-shrink: 0;
      }

      .option--disabled wa-icon {
        color: var(--wa-color-text-quiet);
      }

      .info {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }

      .title {
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-normal);
      }

      .desc {
        font-size: var(--wa-font-size-2xs);
        color: var(--wa-color-text-quiet);
        line-height: 1.4;
      }

      .back-btn {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 0;
        margin-bottom: var(--wa-space-s);
        background: none;
        border: none;
        font-family: inherit;
        font-size: var(--wa-font-size-xs);
        font-weight: var(--wa-font-weight-bold);
        color: var(--esphome-primary);
        cursor: pointer;
      }

      .back-btn wa-icon {
        font-size: 16px;
      }

      .loading {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--wa-space-s);
        padding: var(--wa-space-xl) 0;
        color: var(--wa-color-text-quiet);
        font-size: var(--wa-font-size-s);
      }

      .empty {
        text-align: center;
        padding: var(--wa-space-l) 0;
        color: var(--wa-color-text-quiet);
        font-size: var(--wa-font-size-s);
        line-height: 1.5;
      }
    `,
  ];

  protected render() {
    const methodTitleKey =
      this.mode === "logs"
        ? "dashboard.logs_method_title"
        : "dashboard.install_method_title";
    const label =
      this._view === "method"
        ? this._localize(methodTitleKey)
        : this._localize("dashboard.install_method_select_port");

    return html`
      <wa-dialog
        label=${label}
        ?open=${this.open}
        @wa-after-hide=${this._onClose}
        light-dismiss
      >
        ${this._view === "method" ? this._renderMethodList() : this._renderPortList()}
      </wa-dialog>
    `;
  }

  private _renderMethodList() {
    const isOnline = this.deviceState === DeviceState.ONLINE;
    const hasWebSerial = this._supportsWebSerial;

    return html`
      <div class="list">
        <div
          class="option ${!isOnline ? "option--disabled" : ""}"
          @click=${isOnline ? () => this._selectMethod("ota") : undefined}
        >
          <wa-icon library="mdi" name="wifi"></wa-icon>
          <div class="info">
            <span class="title">${this._localize("dashboard.install_method_network")}</span>
            <span class="desc">${this._localize("dashboard.install_method_network_desc")}</span>
          </div>
        </div>
        <div
          class="option ${!hasWebSerial ? "option--disabled" : ""}"
          @click=${hasWebSerial ? () => this._selectMethod("web-serial") : undefined}
        >
          <wa-icon library="mdi" name="usb"></wa-icon>
          <div class="info">
            <span class="title">${this._localize("dashboard.install_method_usb_local")}</span>
            <span class="desc">${hasWebSerial
              ? this._localize("dashboard.install_method_usb_local_desc")
              : this._localize("dashboard.install_method_usb_local_unsupported")}</span>
          </div>
        </div>
        <div class="option" @click=${this._onServerSerial}>
          <wa-icon library="mdi" name="serial-port"></wa-icon>
          <div class="info">
            <span class="title">${this._localize("dashboard.install_method_usb_server")}</span>
            <span class="desc">${this._localize("dashboard.install_method_usb_server_desc")}</span>
          </div>
        </div>
      </div>
    `;
  }

  private _renderPortList() {
    if (this._loadingPorts) {
      return html`
        <div class="loading">
          <wa-spinner></wa-spinner>
          ${this._localize("dashboard.install_method_loading_ports")}
        </div>
      `;
    }

    return html`
      <button class="back-btn" @click=${() => { this._view = "method"; }}>
        <wa-icon library="mdi" name="arrow-left"></wa-icon>
        ${this._localize("dashboard.install_method_back")}
      </button>
      ${this._ports.length === 0
        ? html`<div class="empty">${this._localize("dashboard.install_method_no_ports")}</div>`
        : html`
            <div class="list">
              ${this._ports.map(
                (p) => html`
                  <div class="option" @click=${() => this._selectPort(p.port)}>
                    <wa-icon library="mdi" name="serial-port"></wa-icon>
                    <div class="info">
                      <span class="title">${p.port}</span>
                      ${p.desc ? html`<span class="desc">${p.desc}</span>` : nothing}
                    </div>
                  </div>
                `,
              )}
            </div>
          `}
    `;
  }

  private async _onServerSerial() {
    this._view = "port-select";
    this._loadingPorts = true;
    try {
      this._ports = await this._api.getSerialPorts();
    } catch {
      this._ports = [];
    }
    this._loadingPorts = false;
  }

  private _selectMethod(method: string) {
    this.dispatchEvent(
      new CustomEvent("select-method", {
        detail: { method },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _selectPort(port: string) {
    this.dispatchEvent(
      new CustomEvent("select-method", {
        detail: { method: "server-serial", port },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _onClose() {
    this.dispatchEvent(
      new CustomEvent("close", { bubbles: true, composed: true }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-install-method-dialog": ESPHomeInstallMethodDialog;
  }
}
