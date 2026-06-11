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
import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import type { ESPHomeAPI } from "../api/index.js";
import { DeviceState } from "../api/types/devices.js";
import type { LocalizeFunc } from "../common/localize.js";
import { apiContext, localizeContext } from "../context/index.js";
import { primaryDialogHeaderStyles } from "../styles/dialog-header.js";
import { inputStyles } from "../styles/inputs.js";
import { newItemHighlightStyles } from "../styles/new-item-highlight.js";
import { espHomeStyles } from "../styles/shared.js";
import { detectEnvironment, type DeploymentEnvironment } from "../util/environment.js";
import { registerMdiIcons } from "../util/register-icons.js";
import { SerialPortsPollController } from "../util/serial-ports-poll-controller.js";
import {
  secureLoopbackUrl,
  webSerialAvailability,
  type WebSerialAvailability,
} from "../util/web-serial.js";
import { installMethodDialogStyles } from "./install-method-dialog.styles.js";

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

  private _portsPoll = new SerialPortsPollController(this, () => this._api);
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

  private get _webSerialAvailability(): WebSerialAvailability {
    return webSerialAvailability();
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
      this._advancedExpanded = false;
      this._otaAddressCardExpanded = false;
      this._otaAddressValue = this.deviceCurrentAddress;
    }
    this._portsPoll.set(this.open && this._view === "port-select");
  }

  static styles = [
    espHomeStyles,
    primaryDialogHeaderStyles,
    inputStyles,
    newItemHighlightStyles,
    installMethodDialogStyles,
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
    const availability = this._webSerialAvailability;
    const hasWebSerial = availability === "available";
    const env = this._environment;
    // Replaces the disabled WebSerial row with web-download when
    // not online (offline or unknown) and no Web Serial. OTA is
    // offered above but may fail; web-download always works.
    const swapInWebDownload =
      this.mode === "install" && !hasWebSerial && !isOnline && this._supportsWebDownload;
    // On localhost the WebSerial option and the server-serial option
    // target the same physical USB stack. There are two collapse cases:
    //
    // - With WebSerial: drop the server-serial row (WebSerial is the
    //   better path, no backend round-trip).
    // - Browser genuinely can't do WebSerial (Safari / Firefox): drop the
    //   *disabled* WebSerial row — the active server-serial row directly
    //   below carries the same "Plug into this computer" label, so the
    //   disabled row only added a duplicate title and a hint with no
    //   actionable fix (the user has a working path right here).
    //
    // When WebSerial is merely blocked by an insecure origin (e.g. 0.0.0.0),
    // KEEP the disabled row — it carries an actionable "open at 127.0.0.1 /
    // https" fix, so it isn't dead weight. On HA / remote both rows point at
    // different machines, so both always stay.
    const showServerSerialRow = !(env === "localhost" && hasWebSerial);
    const dropDisabledWebSerial =
      env === "localhost" && availability === "unsupported" && !swapInWebDownload;
    const serverSerialKeys = this._serverSerialCopyKeys(env);

    return html`
      <div class="list">
        ${this._renderOtaOption(isOnline)}
        ${swapInWebDownload
          ? this._renderWebDownloadOption()
          : dropDisabledWebSerial
            ? nothing
            : this._renderWebSerialOption(availability)}
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

  private _renderWebSerialOption(availability: WebSerialAvailability) {
    const enabled = availability === "available";
    return html`
      <div
        class="option ${!enabled ? "option--disabled" : ""}"
        @click=${enabled ? () => this._selectMethod("web-serial") : undefined}
      >
        <wa-icon library="mdi" name="usb"></wa-icon>
        <div class="info">
          <span class="title"
            >${this._localize("dashboard.install_method_usb_local")}</span
          >
          <span class="desc">${this._renderWebSerialDesc(availability)}</span>
        </div>
      </div>
    `;
  }

  /**
   * Disabled-row hint that names the real blocker. ``insecure-context`` is the
   * common Chrome-on-``0.0.0.0`` case: the browser is capable, the origin
   * isn't a secure context. When the loopback equivalent is known to work
   * (``0.0.0.0`` only) render it as an inline link the user can click to switch
   * origins; otherwise point them at localhost / https generically. Only a
   * genuinely unsupported browser gets the use-a-supported-browser copy. The
   * ``{link}`` split mirrors ``_renderWebDownloadOption`` so locales can place
   * the URL anywhere (falling back to the plain key if a translation omits the
   * marker).
   *
   * Known limitation: on an insecure origin ``navigator.serial`` is absent for
   * EVERY browser, so we can't tell a capable-but-blocked browser from one with
   * no Web Serial support at all. A browser that lacks it (older Firefox, etc.)
   * is therefore shown the loopback link and, on the secure origin, still has no
   * Web Serial. We accept that: the link helps the majority (Chrome, Edge,
   * Firefox 151+) and the copy is phrased as a prerequisite, not a guarantee.
   */
  private _renderWebSerialDesc(availability: WebSerialAvailability) {
    if (availability === "available") {
      return this._localize("dashboard.install_method_usb_local_desc");
    }
    if (availability === "unsupported") {
      return this._localize("dashboard.install_method_usb_local_unsupported");
    }
    const loopback = secureLoopbackUrl();
    if (!loopback) {
      return this._localize("dashboard.install_method_usb_local_insecure");
    }
    const linkText = new URL(loopback).host; // e.g. 127.0.0.1:6052
    const template = this._localize("dashboard.install_method_usb_local_insecure_link");
    if (!template.includes("{link}")) return template;
    const [before, after = ""] = template.split("{link}");
    return html`${before}<a
        class="inline-link"
        href=${loopback}
        @click=${(e: MouseEvent) => e.stopPropagation()}
        >${linkText}</a
      >${after}`;
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
    if (this._portsPoll.loading) {
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
      ${this._portsPoll.ports.length === 0
        ? html`<div class="empty">
            ${this._localize("dashboard.install_method_no_ports")}
          </div>`
        : html`
            <div class="list">
              ${this._portsPoll.ports.map(
                (p) => html`
                  <div
                    class=${classMap({
                      option: true,
                      "is-new": this._portsPoll.newPorts.has(p.port),
                    })}
                    @click=${() => this._selectPort(p.port)}
                  >
                    <wa-icon library="mdi" name="serial-port"></wa-icon>
                    <div class="info">
                      <span class="title">${p.port}</span>
                      ${p.desc ? html`<span class="desc">${p.desc}</span>` : nothing}
                    </div>
                    ${this._portsPoll.newPorts.has(p.port)
                      ? html`<span class="new-badge"
                          >${this._localize("dashboard.serial_port_new")}</span
                        >`
                      : nothing}
                  </div>
                `
              )}
            </div>
          `}
    `;
  }

  private _renderOtaOption(isOnline: boolean) {
    // Install mode keeps the row clickable when not online; the
    // compile runs even if the upload fails. Logs mode has no
    // compile-equivalent so it stays gated on isOnline.
    const enabled = isOnline || this.mode === "install";
    const isOffline = this.deviceState === DeviceState.OFFLINE;
    const titleKey =
      this.mode === "logs"
        ? "dashboard.logs_method_wireless"
        : "dashboard.install_method_network";
    let descKey: string;
    if (this.mode === "logs") {
      descKey = "dashboard.logs_method_wireless_desc";
    } else if (isOffline) {
      descKey = "dashboard.install_method_network_desc_offline";
    } else {
      descKey = "dashboard.install_method_network_desc";
    }
    return html`
      <div
        class="option ${!enabled ? "option--disabled" : ""}"
        @click=${enabled ? () => this._selectMethod("ota") : undefined}
      >
        <wa-icon library="mdi" name="wifi"></wa-icon>
        <div class="info">
          <span class="title">${this._localize(titleKey)}</span>
          <span class="desc">${this._localize(descKey)}</span>
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
                    ${this._localize(
                      this.mode === "logs"
                        ? "dashboard.logs_method_network_address_submit"
                        : "dashboard.install_method_network_address_submit"
                    )}
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

  private _onServerSerial() {
    this._view = "port-select";
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
