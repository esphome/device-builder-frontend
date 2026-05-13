import { consume } from "@lit/context";
import {
  mdiArrowLeft,
  mdiChevronDown,
  mdiChevronRight,
  mdiChevronUp,
  mdiCloudDownload,
  mdiDownload,
  mdiIpNetworkOutline,
  mdiSerialPort,
  mdiUsb,
  mdiWifi,
} from "@mdi/js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { ESPHomeAPI } from "../api/index.js";
import type { SerialPort } from "../api/types.js";
import { DeviceState } from "../api/types.js";
import type { LocalizeFunc } from "../common/localize.js";
import { apiContext, localizeContext } from "../context/index.js";
import { inputStyles } from "../styles/inputs.js";
import { espHomeStyles } from "../styles/shared.js";
import { detectEnvironment, type DeploymentEnvironment } from "../util/environment.js";
import { registerMdiIcons } from "../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/spinner/spinner.js";
import "./base-dialog.js";

registerMdiIcons({
  "arrow-left": mdiArrowLeft,
  "chevron-down": mdiChevronDown,
  "chevron-right": mdiChevronRight,
  "chevron-up": mdiChevronUp,
  wifi: mdiWifi,
  usb: mdiUsb,
  "serial-port": mdiSerialPort,
  "cloud-download": mdiCloudDownload,
  download: mdiDownload,
  "ip-network-outline": mdiIpNetworkOutline,
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
   * `true` when the user has opened the "Advanced options"
   * disclosure at the bottom of the method list. Holds the
   * OTA address-override form and the manual binary-download
   * option. Reset whenever the dialog re-opens (the
   * `willUpdate` hook below).
   */
  @state() private _advancedExpanded = false;
  /**
   * `true` when the chevron on the OTA address-override card
   * is expanded, revealing the IP / hostname input inside the
   * card. Independent of `_advancedExpanded` (the disclosure
   * that holds the card itself) so collapsing and reopening
   * Advanced options doesn't lose this state mid-session.
   */
  @state() private _otaAddressCardExpanded = false;
  @state() private _otaAddressValue = "";

  private get _supportsWebSerial(): boolean {
    return "serial" in navigator;
  }

  private get _environment(): DeploymentEnvironment {
    return detectEnvironment(this._api);
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
      this._advancedExpanded = false;
      this._otaAddressCardExpanded = false;
      this._otaAddressValue = this.deviceCurrentAddress;
    }
  }

  static styles = [
    espHomeStyles,
    inputStyles,
    css`
      esphome-base-dialog {
        --width: 460px;
      }

      esphome-base-dialog::part(header) {
        background: var(--esphome-primary);
        padding: 0 var(--wa-space-m);
        height: 40px;
        box-sizing: border-box;
      }

      esphome-base-dialog::part(title) {
        color: var(--esphome-on-primary);
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
      }

      /* Close-button styling is bundled in
         <esphome-base-dialog> via dialogCloseButtonStyles,
         no per-dialog override needed. */

      esphome-base-dialog::part(body) {
        padding: var(--wa-space-l);
      }

      esphome-base-dialog::part(footer) {
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

      /* "Advanced options" disclosure rendered below the method
         list. Holds the OTA address-override form and the manual
         binary-download option — paths that aren't part of the
         everyday install flow. Styled as an underlined inline
         link rather than a button card so it doesn't compete
         visually with the main method options above. */
      .advanced-toggle {
        display: inline-flex;
        align-items: center;
        margin-top: var(--wa-space-m);
        padding: 0;
        background: none;
        border: none;
        font-family: inherit;
        font-size: var(--wa-font-size-xs);
        font-weight: var(--wa-font-weight-bold);
        color: var(--esphome-primary);
        cursor: pointer;
        /* Underline targets the text only (via text-underline-offset);
           the chevron is excluded from text-decoration below so it
           doesn't sit on the underline rail. */
        text-decoration: underline;
        text-underline-offset: 2px;
      }

      .advanced-toggle__chevron {
        font-size: 16px;
        text-decoration: none;
      }

      .advanced-toggle:focus-visible {
        outline: 2px solid var(--esphome-primary);
        outline-offset: 2px;
      }

      /* Container for the disclosed advanced controls. Stacks
         the OTA address form and the manual-download option with
         the same gap as the main list so the visual rhythm
         stays uniform when expanded. */
      .advanced-panel {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-s);
        margin-top: var(--wa-space-s);
      }

      /* Trailing chevron on option cards. chevron-right on
         direct-action rows (e.g. "Download firmware binary")
         signals "click to proceed"; chevron-down on the IP /
         hostname row signals an expandable card whose form opens
         inline inside the same card. */
      .option-chevron {
        margin-left: auto;
        font-size: 20px;
        color: var(--wa-color-text-quiet);
        flex-shrink: 0;
        transition: color 0.12s;
      }

      .option:hover .option-chevron,
      .option-collapsible:hover .option-chevron {
        color: var(--esphome-primary);
      }

      /* Expandable option card. The header row reuses the same
         icon + title/desc layout as a plain .option; clicking it
         (or any part of the card) toggles an inline body below
         that holds the OTA address form, so the configuration
         lives INSIDE the card rather than as a separate panel. */
      .option-collapsible {
        display: flex;
        flex-direction: column;
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        border-radius: var(--wa-border-radius-l);
        overflow: hidden;
        transition:
          border-color 0.12s,
          background 0.12s;
      }

      .option-collapsible:hover {
        border-color: var(--esphome-primary);
        background: color-mix(in srgb, var(--esphome-primary), transparent 92%);
      }

      .option-collapsible__header {
        display: flex;
        align-items: center;
        gap: var(--wa-space-m);
        padding: var(--wa-space-m);
        background: transparent;
        border: none;
        cursor: pointer;
        width: 100%;
        font-family: inherit;
        color: inherit;
        text-align: left;
      }

      .option-collapsible__header:focus-visible {
        outline: 2px solid var(--esphome-primary);
        outline-offset: -2px;
      }

      .option-collapsible__header wa-icon:first-child {
        font-size: 28px;
        color: var(--esphome-primary);
        flex-shrink: 0;
      }

      .option-collapsible__body {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-s);
        padding: 0 var(--wa-space-m) var(--wa-space-m);
      }

      .ota-form-input {
        width: 100%;
        box-sizing: border-box;
      }

      .ota-form-actions {
        display: flex;
        gap: var(--wa-space-s);
        justify-content: flex-end;
      }

      .ota-form-actions .btn {
        padding: 6px 14px;
        border-radius: var(--wa-border-radius-m);
        font-size: var(--wa-font-size-xs);
        font-weight: var(--wa-font-weight-bold);
        font-family: inherit;
        cursor: pointer;
        border: none;
        transition: background 0.12s;
      }

      .ota-form-actions .btn--primary {
        background: var(--esphome-primary);
        color: var(--esphome-on-primary);
      }

      .ota-form-actions .btn--primary:hover:not(:disabled) {
        background: color-mix(in srgb, var(--esphome-primary), black 10%);
      }

      .ota-form-actions .btn--primary:disabled {
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

      /* Inline link inside an option's title (used by the web.esphome.io
         row to render the host name as a clickable link). stopPropagation
         on the link's click handler keeps the row's "start install" from
         firing when the user just wants to preview the destination. */
      .title .inline-link {
        color: var(--esphome-primary);
        text-decoration: underline;
        text-underline-offset: 2px;
      }
      .title .inline-link:hover,
      .title .inline-link:focus-visible {
        text-decoration-thickness: 2px;
        outline: none;
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
      <esphome-base-dialog
        .label=${label}
        ?open=${this.open}
        @after-hide=${this._onClose}
      >
        ${this._view === "method" ? this._renderMethodList() : this._renderPortList()}
      </esphome-base-dialog>
    `;
  }

  private _renderMethodList() {
    const isOnline = this.deviceState === DeviceState.ONLINE;
    const hasWebSerial = this._supportsWebSerial;
    const env = this._environment;
    // Web-download replaces (rather than supplements) the local USB row
    // when the user can't use Web Serial here AND can't use OTA — the
    // same situation that disabled the USB row before. Keeps the list
    // short by not showing two USB options where only one is reachable.
    const swapInWebDownload =
      this.mode === "install" && !hasWebSerial && !isOnline && this._supportsWebDownload;
    // On localhost the WebSerial option and the server-serial option
    // target the same physical USB stack. There are two collapse cases:
    //
    // - With WebSerial: drop the server-serial row (WebSerial is the
    //   better path, no backend round-trip).
    // - Without WebSerial: drop the *disabled* WebSerial row — the
    //   active server-serial row directly below carries the same
    //   "Plug into this computer" label, so the disabled row only
    //   added a duplicate title and a "you need Chrome" hint that
    //   doesn't apply (the user has a working path right here).
    //
    // On HA / remote the two rows point at different machines, so
    // both stay and the disabled-WebSerial hint is still useful.
    const showServerSerialRow = !(env === "localhost" && hasWebSerial);
    const dropDisabledWebSerial =
      env === "localhost" && !hasWebSerial && !swapInWebDownload;
    const serverSerialKeys = this._serverSerialCopyKeys(env);

    return html`
      <div class="list">
        ${this._renderOtaOption(isOnline)}
        ${swapInWebDownload
          ? this._renderWebDownloadOption()
          : dropDisabledWebSerial
            ? nothing
            : this._renderWebSerialOption(hasWebSerial)}
        ${showServerSerialRow
          ? html`<div class="option" @click=${this._onServerSerial}>
              <wa-icon library="mdi" name="serial-port"></wa-icon>
              <div class="info">
                <span class="title">${this._localize(serverSerialKeys.title)}</span>
                <span class="desc">${this._localize(serverSerialKeys.desc)}</span>
              </div>
            </div>`
          : nothing}
      </div>
      ${this._renderAdvancedSection()}
    `;
  }

  /**
   * Pick the title/desc localisation keys for the server-serial row
   * based on where the backend is running. On HA the user is
   * plugging into their HA server; on a local backend without
   * WebSerial they're plugging into their own machine; remote
   * setups use the generic phrasing.
   */
  private _serverSerialCopyKeys(env: DeploymentEnvironment): {
    title: string;
    desc: string;
  } {
    switch (env) {
      case "ha-addon":
        return {
          title: "dashboard.install_method_usb_server_ha",
          desc: "dashboard.install_method_usb_server_ha_desc",
        };
      case "localhost":
        return {
          title: "dashboard.install_method_usb_server_localhost",
          desc: "dashboard.install_method_usb_server_localhost_desc",
        };
      case "remote":
      default:
        return {
          title: "dashboard.install_method_usb_server",
          desc: "dashboard.install_method_usb_server_desc",
        };
    }
  }

  private _renderWebSerialOption(hasWebSerial: boolean) {
    return html`
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
    `;
  }

  /**
   * web.esphome.io fallback row. Renders the host name as an inline
   * link inside the title so users can preview / right-click open the
   * destination before committing to the compile + download. The link
   * stops click propagation so opening it doesn't double-fire as a
   * "start install" on the parent row.
   *
   * Translation splits on the ``{link}`` marker so other locales can
   * place the URL anywhere within the sentence. Locales that don't
   * include the marker (e.g. an older translation that already inlines
   * the host name) fall back to rendering the title verbatim — without
   * this guard the link would be appended after the existing inlined
   * URL, producing duplicates like "... web.esphome.io web.esphome.io".
   */
  private _renderWebDownloadOption() {
    const titleTemplate = this._localize("dashboard.install_method_web_download");
    const linkText = this._localize("dashboard.install_method_web_download_link");
    const hasMarker = titleTemplate.includes("{link}");
    const [before, after = ""] = titleTemplate.split("{link}");
    return html`
      <div class="option" @click=${() => this._selectMethod("web-download")}>
        <wa-icon library="mdi" name="cloud-download"></wa-icon>
        <div class="info">
          <span class="title"
            >${hasMarker
              ? html`${before}<a
                    class="inline-link"
                    href="https://web.esphome.io"
                    target="_blank"
                    rel="noopener noreferrer"
                    @click=${(e: MouseEvent) => e.stopPropagation()}
                    >${linkText}</a
                  >${after}`
              : titleTemplate}</span
          >
          <span class="desc"
            >${this._localize("dashboard.install_method_web_download_desc")}</span
          >
        </div>
      </div>
    `;
  }

  /**
   * Manual binary download — always offered in install mode. Compiles
   * here, hands the user the resulting binary, and leaves flashing to
   * whatever tool they prefer (esptool.py, picotool, copy-to-MSC for
   * UF2 platforms, etc). Distinct from the web-download row, which
   * specifically routes the user through web.esphome.io and is gated
   * to ESP32 / ESP8266.
   */
  private _renderManualDownloadOption() {
    return html`
      <div class="option" @click=${() => this._selectMethod("binary-download")}>
        <wa-icon library="mdi" name="download"></wa-icon>
        <div class="info">
          <span class="title"
            >${this._localize("dashboard.install_method_manual_download")}</span
          >
          <span class="desc"
            >${this._localize("dashboard.install_method_manual_download_desc")}</span
          >
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

  private _renderOtaOption(isOnline: boolean) {
    return html`
      <div
        class="option ${!isOnline ? "option--disabled" : ""}"
        @click=${isOnline ? () => this._selectMethod("ota") : undefined}
      >
        <wa-icon library="mdi" name="wifi"></wa-icon>
        <div class="info">
          <span class="title">${this._localize("dashboard.install_method_network")}</span>
          <span class="desc"
            >${this._localize("dashboard.install_method_network_desc")}</span
          >
        </div>
      </div>
    `;
  }

  /**
   * "Advanced options" disclosure at the bottom of the method
   * list. Holds the OTA address-override card (target a specific
   * IP / hostname — useful when the device hasn't been resolved
   * yet, or when overriding the dashboard's auto-detected
   * address) and, in install mode, the manual binary-download
   * option (compile here, flash with an external tool).
   */
  private _renderAdvancedSection() {
    const expanded = this._advancedExpanded;
    return html`
      <button
        type="button"
        class="advanced-toggle"
        aria-expanded=${expanded ? "true" : "false"}
        aria-controls=${expanded ? "advanced-panel" : nothing}
        @click=${this._onToggleAdvanced}
      >
        ${this._localize("dashboard.install_method_advanced_toggle")}
        <wa-icon
          class="advanced-toggle__chevron"
          library="mdi"
          name=${expanded ? "chevron-up" : "chevron-down"}
        ></wa-icon>
      </button>
      ${expanded
        ? html`
            <div id="advanced-panel" class="advanced-panel">
              ${this._renderOtaAddressCard()}
              ${this.mode === "install" ? this._renderManualDownloadOption() : nothing}
            </div>
          `
        : nothing}
    `;
  }

  /**
   * OTA address-override card. Header row mirrors the other
   * .option cards (icon + title + description) and the chevron
   * toggles an inline form INSIDE the same card so the address
   * input lives within the card's outline rather than dangling
   * below as a separate panel.
   */
  private _renderOtaAddressCard() {
    const expanded = this._otaAddressCardExpanded;
    const trimmed = this._otaAddressValue.trim();
    const canSubmit = trimmed.length > 0 && trimmed !== "OTA";
    return html`
      <div class="option-collapsible">
        <button
          type="button"
          class="option-collapsible__header"
          aria-expanded=${expanded ? "true" : "false"}
          aria-controls=${expanded ? "ota-address-form" : nothing}
          @click=${this._onToggleOtaAddressCard}
        >
          <wa-icon library="mdi" name="ip-network-outline"></wa-icon>
          <div class="info">
            <span class="title" id="ota-address-title"
              >${this._localize("dashboard.install_method_network_address_label")}</span
            >
            <span class="desc"
              >${this._localize("dashboard.install_method_network_address_desc")}</span
            >
          </div>
          <wa-icon
            class="option-chevron"
            library="mdi"
            name=${expanded ? "chevron-up" : "chevron-down"}
          ></wa-icon>
        </button>
        ${expanded
          ? html`
              <div id="ota-address-form" class="option-collapsible__body">
                <input
                  class="ota-form-input"
                  type="text"
                  autocomplete="off"
                  spellcheck="false"
                  placeholder="192.168.1.42"
                  aria-labelledby="ota-address-title"
                  .value=${this._otaAddressValue}
                  @input=${(e: Event) => {
                    this._otaAddressValue = (e.target as HTMLInputElement).value;
                  }}
                  @keydown=${(e: KeyboardEvent) => {
                    if (e.key === "Enter" && canSubmit) {
                      this._submitOtaAddress();
                    }
                  }}
                />
                <div class="ota-form-actions">
                  <button
                    class="btn btn--primary"
                    ?disabled=${!canSubmit}
                    @click=${this._submitOtaAddress}
                  >
                    ${this._localize("dashboard.install_method_network_address_submit")}
                  </button>
                </div>
              </div>
            `
          : nothing}
      </div>
    `;
  }

  private _onToggleAdvanced = () => {
    this._advancedExpanded = !this._advancedExpanded;
  };

  private _onToggleOtaAddressCard = () => {
    this._otaAddressCardExpanded = !this._otaAddressCardExpanded;
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
