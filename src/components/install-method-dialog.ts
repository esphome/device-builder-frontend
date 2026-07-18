import { consume } from "@lit/context";
import {
  mdiArrowLeft,
  mdiChevronDown,
  mdiChevronRight,
  mdiChevronUp,
  mdiChip,
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
import { disclosureStyles } from "../styles/disclosure.js";
import { emptyStateStyles } from "../styles/empty-state.js";
import { inputStyles } from "../styles/inputs.js";
import { newItemHighlightStyles } from "../styles/new-item-highlight.js";
import { serialPortHintStyles } from "../styles/serial-port-hints.js";
import { espHomeStyles } from "../styles/shared.js";
import { detectEnvironment, type DeploymentEnvironment } from "../util/environment.js";
import { isEsptoolPlatform } from "../util/esptool-platform.js";
import { registerMdiIcons } from "../util/register-icons.js";
import { SerialPortsPollController } from "../util/serial-ports-poll-controller.js";
import {
  secureLoopbackUrl,
  webSerialAvailability,
  type WebSerialAvailability,
} from "../util/web-serial.js";
import {
  renderBootloaderOption,
  renderInstallNotice,
  renderManualDownloadOption,
  renderMethodRow,
  renderOtaOption,
  renderServerSerialOption,
  type MethodRowContext,
} from "./install-method-dialog-rows.js";
import { installMethodDialogStyles } from "./install-method-dialog.styles.js";
import { renderDisclosure } from "./shared/disclosure.js";
import {
  renderSerialPortBadges,
  renderSerialPortReplugHint,
} from "./shared/serial-port-hints.js";

import "@home-assistant/webawesome/dist/components/callout/callout.js";
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
  download: mdiDownload,
  "ip-network-outline": mdiIpNetworkOutline,
  chip: mdiChip,
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

  /**
   * Shows the "Update bootloader" advanced option. Hosts compute it
   * via `canFlashBootloader`: the YAML enables `allow_partition_access`
   * AND the running firmware was built with it (hash match).
   */
  @property({ type: Boolean, attribute: "can-flash-bootloader" })
  canFlashBootloader = false;

  /**
   * Device has never run ESPHome firmware (``isNeverFlashed``). Leads
   * with the USB rows and swaps in first-install copy — a queued OTA
   * can never reach a board that has never been online.
   */
  @property({ type: Boolean, attribute: "never-flashed" })
  neverFlashed = false;

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

  // Gates the browser-flasher USB row to ESP families; see isEsptoolPlatform
  // for why non-ESP targets are excluded.
  private get _isEsptoolPlatform(): boolean {
    return isEsptoolPlatform(this.deviceTargetPlatform);
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
    disclosureStyles,
    primaryDialogHeaderStyles,
    inputStyles,
    newItemHighlightStyles,
    serialPortHintStyles,
    emptyStateStyles,
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
    const availability = this._webSerialAvailability;
    const hasWebSerial = availability === "available";
    const env = this._environment;
    // Browser flashers (in-app Web Serial esptool-js, the external flasher) are
    // ESP-only. Non-ESP targets (RP2040 / RP2350, nrf52, libretiny) flash over
    // serial only via the backend (`esphome run` / server-serial).
    const isEsptool = this._isEsptoolPlatform;
    const isLogs = this.mode === "logs";
    // Drop the redundant server-serial row only when in-app Web Serial is
    // actually available on localhost (same USB stack). Keep it on insecure
    // origins as a fallback: there a Web-Serial-incapable browser (Safari) still
    // needs a working serial path, and we can't detect that case client-side.
    const showServerSerialRow = !(env === "localhost" && hasWebSerial && isEsptool);
    // On localhost a Web-Serial-incapable browser gets the same "Plug into this
    // computer" path from the server-serial row, so drop the disabled USB hint
    // there to avoid a duplicate, non-actionable title.
    const dropDisabledUsb = env === "localhost" && availability === "unsupported";
    // The external flasher only flashes (install). In logs mode the USB row is
    // actionable solely via in-app Web Serial, so show it only when that's
    // available; otherwise logs go through server-serial / OTA.
    const showUsbRow = isEsptool && (isLogs ? hasWebSerial : !dropDisabledUsb);

    const ctx = this._rowContext();
    const otaRow = renderOtaOption(ctx);
    const usbRow = showUsbRow ? this._renderUsbOption(availability) : nothing;
    const serverRow = showServerSerialRow
      ? renderServerSerialOption(this._localize, env, () => this._onServerSerial())
      : nothing;
    // A never-flashed device can't receive an OTA by itself — lead with
    // the USB rows so the first install goes over a cable. At least one
    // of the two renders in install mode (their hide conditions are
    // mutually exclusive).
    const usbFirst = !isLogs && this.neverFlashed;
    const rows = usbFirst ? [usbRow, serverRow, otaRow] : [otaRow, usbRow, serverRow];

    return html`
      ${renderInstallNotice(ctx)}
      <div class="list">${rows}</div>
      ${this._renderAdvancedSection(ctx)}
    `;
  }

  private _rowContext(): MethodRowContext {
    return {
      localize: this._localize,
      mode: this.mode,
      deviceState: this.deviceState,
      neverFlashed: this.neverFlashed,
      onSelect: (method) => this._selectMethod(method),
    };
  }

  /**
   * Single "Plug in via USB" row for ESP devices.
   *
   * - ``available``: in-app Web Serial (secure context, capable browser).
   * - ``insecure-context``: the browser has Web Serial but this origin isn't
   *   secure — open the external secure-context flasher (handing the firmware
   *   off over postMessage). When a same-machine secure loopback exists
   *   (``0.0.0.0`` -> ``127.0.0.1``), the desc also offers an inline link to
   *   switch origins and flash in-app locally instead.
   * - ``unsupported``: the browser lacks Web Serial entirely; the external
   *   flasher runs in the same browser, so it can't help — disable with a hint.
   *
   * Detection caveat: ``unsupported`` is only distinguishable in a SECURE
   * context (e.g. Safari over https). On an insecure origin (the HA add-on over
   * http) ``webSerialAvailability()`` returns ``insecure-context`` for every
   * browser, since ``navigator.serial`` is hidden regardless of support — so a
   * Web-Serial-incapable browser there still gets the enabled external-flasher
   * row, and the flasher tab itself surfaces the "no Web Serial" error.
   */
  private _renderUsbOption(availability: WebSerialAvailability) {
    const title = this._localize("dashboard.install_method_usb_local");
    if (availability === "unsupported") {
      return renderMethodRow({
        icon: "usb",
        title,
        desc: this._localize("dashboard.install_method_usb_local_unsupported"),
      });
    }
    const inApp = availability === "available";
    return renderMethodRow({
      icon: "usb",
      title,
      desc: inApp
        ? this._localize("dashboard.install_method_usb_local_desc")
        : this._renderUsbRemoteDesc(),
      onClick: () => this._selectMethod(inApp ? "web-serial" : "web-flash"),
    });
  }

  /**
   * Desc for the insecure-context USB row. On ``0.0.0.0`` a same-machine
   * secure loopback exists, so offer a ``127.0.0.1`` link (stop-propagation so
   * it doesn't also trigger the row's external-flasher action) to flash in-app
   * locally; otherwise (HA-http / LAN IP) just describe the external flasher.
   */
  private _renderUsbRemoteDesc() {
    const loopback = secureLoopbackUrl();
    if (!loopback) {
      return this._localize("dashboard.install_method_usb_remote_desc");
    }
    const template = this._localize("dashboard.install_method_usb_remote_loopback");
    if (!template.includes("{link}")) {
      // A locale that hasn't added the {link} marker still shows its own copy.
      return template;
    }
    const linkText = new URL(loopback).host; // e.g. 127.0.0.1:6052
    const [before, after = ""] = template.split("{link}");
    return html`${before}<a
        class="inline-link"
        href=${loopback}
        @click=${(e: MouseEvent) => e.stopPropagation()}
        >${linkText}</a
      >${after}`;
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
      ${
        this._portsPoll.ports.length === 0
          ? html`<div class="empty-message">
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
                      ${renderSerialPortBadges(p, this._portsPoll.newPorts, this._localize)}
                    </div>
                  `
                )}
              </div>
              ${renderSerialPortReplugHint(this._portsPoll.ports, this._localize)}
            `
      }
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
  private _renderAdvancedSection(ctx: MethodRowContext) {
    return renderDisclosure({
      open: this._advancedExpanded,
      onToggle: () => this._onToggleAdvanced(),
      localize: this._localize,
      labelKey: "dashboard.install_method_advanced_toggle",
      variant: "link",
      panelId: "advanced-panel",
      body: () => html`
        <div class="advanced-panel-content">
          ${this._renderOtaAddressCard()}
          ${
            this.mode === "install" &&
            this.canFlashBootloader &&
            this.deviceState === DeviceState.ONLINE
              ? renderBootloaderOption(ctx)
              : nothing
          }
          ${this.mode === "install" ? renderManualDownloadOption(ctx) : nothing}
        </div>
      `,
    });
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
        ${
          expanded
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
            : nothing
        }
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
