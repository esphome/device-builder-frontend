import { consume } from "@lit/context";
import {
  mdiArrowLeft,
  mdiChevronDown,
  mdiChevronUp,
  mdiCloudDownload,
  mdiSerialPort,
  mdiUsb,
  mdiWifi,
} from "@mdi/js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { ESPHomeAPI } from "../api/index.js";
import { DeviceState } from "../api/types.js";
import type { SerialPort } from "../api/types.js";
import type { LocalizeFunc } from "../common/localize.js";
import { apiContext, localizeContext } from "../context/index.js";
import { inputStyles } from "../styles/inputs.js";
import { espHomeStyles } from "../styles/shared.js";
import { registerMdiIcons } from "../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/dialog/dialog.js";
import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/spinner/spinner.js";

registerMdiIcons({
  "arrow-left": mdiArrowLeft,
  "chevron-down": mdiChevronDown,
  "chevron-up": mdiChevronUp,
  wifi: mdiWifi,
  usb: mdiUsb,
  "serial-port": mdiSerialPort,
  "cloud-download": mdiCloudDownload,
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
  deviceTargetPlatform = "";

  @property()
  mode: "install" | "logs" = "install";

  /**
   * Pre-fills the OTA address-override input. Sourced from the
   * device's resolved IP (or its configured address as a
   * fallback) so the user only has to edit a single octet
   * rather than retyping the whole address. Empty when neither
   * is known — the input still works, just starts blank.
   */
  @property()
  deviceCurrentAddress = "";

  @state() private _view: DialogView = "method";
  @state() private _ports: SerialPort[] = [];
  @state() private _loadingPorts = false;
  /**
   * `true` when the user has clicked the chevron on the OTA row
   * to reveal the address-override input. Clicking the OTA row
   * itself (default click target) still triggers a default-
   * address OTA — the chevron is the explicit "I want to pick a
   * specific IP" path. Reset whenever the dialog re-opens (the
   * `willUpdate` hook below).
   */
  @state() private _otaAddressExpanded = false;
  @state() private _otaAddressValue = "";

  private get _supportsWebSerial(): boolean {
    return "serial" in navigator;
  }

  /**
   * web.esphome.io / esp-web-tools only supports ESP32 (all variants)
   * and ESP8266. UF2 platforms (RP2040, nrf52, libretiny) ship a
   * different binary format that the browser flasher can't handle, so
   * we hide the option entirely for those.
   */
  private get _supportsWebDownload(): boolean {
    const p = this.deviceTargetPlatform.toLowerCase();
    return p.startsWith("esp32") || p === "esp8266";
  }

  protected willUpdate(changed: Map<string, unknown>) {
    // Reset to method view when dialog opens. Also collapse the
    // OTA address override and re-seed its input from the
    // device's current address (so per-open the field starts at
    // a sensible default — typically the IP the dashboard
    // resolved to, where the user just edits a single octet).
    if (changed.has("open") && this.open) {
      this._view = "method";
      this._ports = [];
      this._otaAddressExpanded = false;
      this._otaAddressValue = this.deviceCurrentAddress;
    }
  }

  static styles = [
    espHomeStyles,
    inputStyles,
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
        cursor: not-allowed;
      }

      /* Fade only the row's content (icon + title/desc) on
         disabled — NOT the container — so a child like
         .chevron-btn (the OTA row's address-override disclosure,
         which works regardless of online state) can override
         back to full opacity. opacity on the container would
         cascade to every descendant regardless of child rules;
         targeted children let exceptions exist. */
      .option--disabled > wa-icon,
      .option--disabled .info {
        opacity: 0.45;
      }

      .option wa-icon {
        font-size: 28px;
        color: var(--esphome-primary);
        flex-shrink: 0;
      }

      .option--disabled > wa-icon {
        color: var(--wa-color-text-quiet);
      }

      /* The chevron is a disclosure affordance on the OTA row —
         click the row for default-address OTA, click the chevron
         to expand the address-override form below. Always-on
         pill background (not just on hover) so the chevron reads
         as clickable at a glance; without it the bare icon was
         hard to spot in the dark theme.

         e.stopPropagation in the chevron's click handler keeps
         the row's default-OTA from also firing on chevron clicks.
         margin-left: auto pins it to the row's trailing edge
         regardless of text width. */
      .chevron-btn {
        margin-left: auto;
        width: 32px;
        height: 32px;
        padding: 0;
        background: color-mix(in srgb, var(--esphome-primary), transparent 88%);
        border: var(--wa-border-width-s) solid
          color-mix(in srgb, var(--esphome-primary), transparent 70%);
        border-radius: 999px;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: var(--esphome-primary);
        flex-shrink: 0;
        transition: background 0.12s, border-color 0.12s, color 0.12s;
      }

      .chevron-btn:hover {
        background: color-mix(in srgb, var(--esphome-primary), transparent 75%);
        border-color: var(--esphome-primary);
      }

      .chevron-btn:focus-visible {
        outline: 2px solid var(--esphome-primary);
        outline-offset: 2px;
      }

      .chevron-btn wa-icon {
        font-size: 18px;
        color: inherit;
      }

      /* When the OTA row is disabled (device not online), the row's
         click handler is suppressed and the icon + info fade. The
         chevron-driven address override is the path that's MOST
         useful in that case — typing an IP doesn't depend on the
         dashboard having resolved the device — so explicitly
         restore the chevron's pointer cursor on top of the parent
         .option--disabled's not-allowed default. (Opacity doesn't
         need overriding here because the disabled rule targets
         icon + info only, not the chevron.) */
      .option--disabled .chevron-btn {
        cursor: pointer;
      }

      /* The expanded address form is a separate card directly
         below the OTA row, sized to match it: full row width
         (no left-inset) and the same default surface background
         so the dialog reads as a uniform list of options + the
         option's own expanded panel. Same border + radius as
         the .option rule to preserve the visual rhythm.
         A standalone wrapper rather than reusing the .option
         class so we don't inherit .option's flex-row +
         align-items: center, which would re-center the form's
         contents and clip its width. */
      .ota-form {
        padding: var(--wa-space-m);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        border-radius: var(--wa-border-radius-l);
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-xs);
      }

      .ota-form label {
        font-size: var(--wa-font-size-2xs);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-quiet);
      }

      .ota-form input {
        width: 100%;
        box-sizing: border-box;
      }

      .ota-form .actions {
        display: flex;
        gap: var(--wa-space-s);
        justify-content: flex-end;
      }

      .ota-form .btn {
        padding: 6px 14px;
        border-radius: var(--wa-border-radius-m);
        font-size: var(--wa-font-size-xs);
        font-weight: var(--wa-font-weight-bold);
        font-family: inherit;
        cursor: pointer;
        border: none;
        transition: background 0.12s;
      }

      .ota-form .btn--primary {
        background: var(--esphome-primary);
        color: var(--esphome-on-primary);
      }

      .ota-form .btn--primary:hover:not(:disabled) {
        background: color-mix(in srgb, var(--esphome-primary), black 10%);
      }

      .ota-form .btn--primary:disabled {
        opacity: 0.5;
        cursor: not-allowed;
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
    const showWebDownload =
      this.mode === "install" && !hasWebSerial && !isOnline && this._supportsWebDownload;

    return html`
      <div class="list">
        ${this._renderOtaOption(isOnline)}
        <div
          class="option ${!hasWebSerial ? "option--disabled" : ""}"
          @click=${hasWebSerial ? () => this._selectMethod("web-serial") : undefined}
        >
          <wa-icon library="mdi" name="usb"></wa-icon>
          <div class="info">
            <span class="title"
              >${this._localize("dashboard.install_method_usb_local")}</span
            >
            <span class="desc"
              >${hasWebSerial
                ? this._localize("dashboard.install_method_usb_local_desc")
                : this._localize("dashboard.install_method_usb_local_unsupported")}</span
            >
          </div>
        </div>
        <div class="option" @click=${this._onServerSerial}>
          <wa-icon library="mdi" name="serial-port"></wa-icon>
          <div class="info">
            <span class="title"
              >${this._localize("dashboard.install_method_usb_server")}</span
            >
            <span class="desc"
              >${this._localize("dashboard.install_method_usb_server_desc")}</span
            >
          </div>
        </div>
        ${showWebDownload
          ? html`
              <div class="option" @click=${() => this._selectMethod("web-download")}>
                <wa-icon library="mdi" name="cloud-download"></wa-icon>
                <div class="info">
                  <span class="title"
                    >${this._localize("dashboard.install_method_web_download")}</span
                  >
                  <span class="desc"
                    >${this._localize("dashboard.install_method_web_download_desc")}</span
                  >
                </div>
              </div>
            `
          : nothing}
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
      <button
        class="back-btn"
        @click=${() => {
          this._view = "method";
        }}
      >
        <wa-icon library="mdi" name="arrow-left"></wa-icon>
        ${this._localize("dashboard.install_method_back")}
      </button>
      ${this._ports.length === 0
        ? html`<div class="empty">
            ${this._localize("dashboard.install_method_no_ports")}
          </div>`
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
                `
              )}
            </div>
          `}
    `;
  }

  /**
   * The OTA "Install over network" option is split: the main row
   * runs a default-address OTA (current behaviour), and a chevron
   * at the row's trailing edge expands an inline address-override
   * form so the user can target a specific IP without leaving
   * this dialog. Folds in the previous "Install to specific
   * address" kebab item — kebab now shows a single Install entry
   * that opens this dialog and surfaces the variant inline.
   *
   * Disabled rows still show the chevron — the override path
   * works against an offline / not-yet-resolved device too
   * (typing an IP doesn't depend on dashboard's auto-resolve),
   * which is exactly the case where the override is most useful.
   */
  private _renderOtaOption(isOnline: boolean) {
    const expanded = this._otaAddressExpanded;
    const trimmed = this._otaAddressValue.trim();
    const canSubmit = trimmed.length > 0 && trimmed !== "OTA";
    return html`
      <div
        class="option ${!isOnline ? "option--disabled" : ""}"
        @click=${isOnline ? () => this._selectMethod("ota") : undefined}
      >
        <wa-icon library="mdi" name="wifi"></wa-icon>
        <div class="info">
          <span class="title"
            >${this._localize("dashboard.install_method_network")}</span
          >
          <span class="desc"
            >${this._localize("dashboard.install_method_network_desc")}</span
          >
        </div>
        <button
          type="button"
          class="chevron-btn"
          aria-expanded=${expanded ? "true" : "false"}
          aria-controls=${expanded ? "ota-address-form" : nothing}
          aria-label=${this._localize(
            "dashboard.install_method_network_address_toggle",
          )}
          @click=${this._onToggleOtaAddress}
        >
          <wa-icon
            library="mdi"
            name=${expanded ? "chevron-up" : "chevron-down"}
          ></wa-icon>
        </button>
      </div>
      ${expanded
        ? html`
            <div id="ota-address-form" class="ota-form">
              <label for="ota-address-input"
                >${this._localize(
                  "dashboard.install_method_network_address_label",
                )}</label
              >
              <input
                id="ota-address-input"
                type="text"
                autocomplete="off"
                spellcheck="false"
                placeholder="192.168.1.42"
                .value=${this._otaAddressValue}
                @input=${(e: Event) => {
                  this._otaAddressValue = (
                    e.target as HTMLInputElement
                  ).value;
                }}
                @keydown=${(e: KeyboardEvent) => {
                  if (e.key === "Enter" && canSubmit) {
                    this._submitOtaAddress();
                  }
                }}
              />
              <div class="actions">
                <button
                  class="btn btn--primary"
                  ?disabled=${!canSubmit}
                  @click=${this._submitOtaAddress}
                >
                  ${this._localize(
                    "dashboard.install_method_network_address_submit",
                  )}
                </button>
              </div>
            </div>
          `
        : nothing}
    `;
  }

  private _onToggleOtaAddress = (e: MouseEvent) => {
    // Stop the click from bubbling to the parent OTA row, which
    // would otherwise fire the default-address OTA path.
    e.stopPropagation();
    this._otaAddressExpanded = !this._otaAddressExpanded;
  };

  private _submitOtaAddress = () => {
    const port = this._otaAddressValue.trim();
    if (!port || port === "OTA") return;
    this._selectMethod("ota", port);
  };

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

  private _selectMethod(method: string, port?: string) {
    this.dispatchEvent(
      new CustomEvent("select-method", {
        detail: port ? { method, port } : { method },
        bubbles: true,
        composed: true,
      })
    );
  }

  private _selectPort(port: string) {
    this.dispatchEvent(
      new CustomEvent("select-method", {
        detail: { method: "server-serial", port },
        bubbles: true,
        composed: true,
      })
    );
  }

  private _onClose() {
    this.dispatchEvent(new CustomEvent("close", { bubbles: true, composed: true }));
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-install-method-dialog": ESPHomeInstallMethodDialog;
  }
}
