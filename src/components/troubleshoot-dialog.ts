/**
 * Offline troubleshooting dialog, opened from the status badge on the
 * device card, table row, and drawer. Auto-runs the backend's
 * `devices/troubleshoot` probe on open, renders the concrete results
 * plus device-specific advice (`util/troubleshoot-tree.ts`), and ends
 * with the manual `use_address` fix (`util/use-address-yaml.ts`).
 */
import { consume } from "@lit/context";
import {
  mdiArrowLeft,
  mdiCheckCircle,
  mdiChevronRight,
  mdiCloseCircle,
  mdiHelpCircleOutline,
  mdiOpenInNew,
} from "@mdi/js";
import {
  css,
  html,
  LitElement,
  nothing,
  type PropertyValues,
  type TemplateResult,
} from "lit";
import { customElement, state } from "lit/decorators.js";
import type { ESPHomeAPI } from "../api/esphome-api.js";
import type { ConfiguredDevice } from "../api/types/devices.js";
import type {
  ReachabilityStateEvent,
  ReachabilitySubscription,
} from "../api/types/reachability.js";
import type { DeviceTroubleshootResult } from "../api/types/troubleshoot.js";
import type { LocalizeFunc } from "../common/localize.js";
import { apiContext, devicesContext, localizeContext } from "../context/index.js";
import { warningBannerStyles } from "../styles/banners.js";
import { modalDialogStyles } from "../styles/modal-dialog.js";
import { espHomeStyles } from "../styles/shared.js";
import { DialogOpenController } from "../util/dialog-open-controller.js";
import { registerMdiIcons } from "../util/register-icons.js";
import {
  buildTroubleshootSections,
  USE_ADDRESS_DOCS_URL,
} from "../util/troubleshoot-tree.js";
import {
  applyUseAddress,
  isIpLiteral,
  isValidUseAddress,
  snippetNetworkSection,
} from "../util/use-address-yaml.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/spinner/spinner.js";
import "./base-dialog.js";

registerMdiIcons({
  "arrow-left": mdiArrowLeft,
  "check-circle": mdiCheckCircle,
  "chevron-right": mdiChevronRight,
  "close-circle": mdiCloseCircle,
  "help-circle-outline": mdiHelpCircleOutline,
  "open-in-new": mdiOpenInNew,
});

export interface TroubleshootTarget {
  configuration: string;
}

type SaveState = "idle" | "saving" | "saved" | "snippet" | "error";

@customElement("esphome-troubleshoot-dialog")
export class ESPHomeTroubleshootDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: apiContext })
  private _api!: ESPHomeAPI;

  @consume({ context: devicesContext, subscribe: true })
  @state()
  private _devices: ConfiguredDevice[] = [];

  private readonly _dialog = new DialogOpenController(this);

  @state() private _name = "";
  @state() private _configuration = "";
  @state() private _result: DeviceTroubleshootResult | null = null;
  @state() private _checking = false;
  @state() private _checkFailed = false;
  @state() private _reachability: ReachabilityStateEvent | null = null;
  @state() private _addressInput = "";
  @state() private _addressInvalid = false;
  @state() private _saveState: SaveState = "idle";
  @state() private _screen: "main" | "address" = "main";
  @state() private _existingAddress = "";

  private _subscription: ReachabilitySubscription | null = null;
  private _snippetYaml = "";

  static styles = [
    espHomeStyles,
    modalDialogStyles,
    warningBannerStyles,
    css`
      :host {
        display: contents;
      }

      esphome-base-dialog {
        --width: 520px;
      }

      .probe-rows {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-2xs);
        margin-bottom: var(--wa-space-m);
        padding: var(--wa-space-s);
        border-radius: var(--wa-border-radius-m);
        background: var(--wa-color-surface-lowered);
        font-size: var(--wa-font-size-s);
      }

      .probe-row {
        display: flex;
        align-items: center;
        gap: var(--wa-space-xs);
      }

      .probe-row wa-icon {
        flex-shrink: 0;
        font-size: 16px;
      }

      .probe-row.ok wa-icon {
        color: var(--esphome-success, #2e7d32);
      }

      .probe-row.fail wa-icon {
        color: var(--esphome-error);
      }

      .probe-row.neutral wa-icon {
        color: var(--wa-color-text-quiet);
      }

      .checking {
        display: flex;
        align-items: center;
        gap: var(--wa-space-xs);
        color: var(--wa-color-text-quiet);
        font-size: var(--wa-font-size-s);
        margin-bottom: var(--wa-space-m);
      }

      .section {
        margin-bottom: var(--wa-space-m);
      }

      .section h3 {
        margin: 0 0 var(--wa-space-2xs);
        font-size: var(--wa-font-size-m);
        font-weight: var(--wa-font-weight-semibold);
      }

      /* Deliberately quiet: the manual address is the last resort, so
         this must not read as the recommended action. */
      .drill {
        display: inline-flex;
        align-items: center;
        gap: 2px;
        padding: 0;
        border: none;
        background: transparent;
        color: var(--wa-color-text-quiet);
        font: inherit;
        font-size: var(--wa-font-size-xs);
        cursor: pointer;
      }

      .drill:hover {
        color: var(--wa-color-text-normal);
        text-decoration: underline;
      }

      .drill wa-icon {
        flex-shrink: 0;
        font-size: 14px;
      }

      .back-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: var(--wa-space-2xs);
        border: none;
        background: transparent;
        color: var(--wa-color-text-normal);
        cursor: pointer;
        font-size: 20px;
      }

      .section p {
        margin: 0 0 var(--wa-space-s);
        font-size: var(--wa-font-size-s);
        color: var(--wa-color-text-quiet);
        line-height: 1.5;
      }

      .section a {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: var(--wa-font-size-s);
        color: var(--esphome-primary);
      }

      .address-label {
        display: flex;
        align-items: baseline;
        gap: var(--wa-space-xs);
        margin: 0 0 var(--wa-space-2xs);
        font-size: var(--wa-font-size-s);
      }

      .address-label code {
        font-family: var(--wa-font-family-code, monospace);
        font-weight: var(--wa-font-weight-semibold);
        color: var(--wa-color-text-normal);
      }

      .address-label span {
        font-size: var(--wa-font-size-xs);
        color: var(--wa-color-text-quiet);
      }

      .address-form {
        display: flex;
        gap: var(--wa-space-xs);
      }

      .address-form input {
        flex: 1;
        padding: var(--wa-space-2xs) var(--wa-space-xs);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        border-radius: var(--wa-border-radius-m);
        background: var(--wa-color-surface-default);
        color: var(--wa-color-text-normal);
        font: inherit;
        font-size: var(--wa-font-size-s);
      }

      .address-form input.invalid {
        border-color: var(--esphome-error);
      }

      .field-error {
        color: var(--esphome-error);
      }

      .btn--confirm {
        background: var(--esphome-primary);
        color: var(--esphome-on-primary);
      }

      .btn--confirm:hover {
        background: var(--esphome-primary-hover);
      }

      .section p.warning-banner {
        margin: 0 0 var(--wa-space-s);
      }

      .saved-panel {
        display: flex;
        align-items: flex-start;
        gap: var(--wa-space-s);
        padding: var(--wa-space-m) 0;
      }

      .saved-panel wa-icon {
        flex-shrink: 0;
        font-size: 24px;
        color: var(--esphome-success, #2e7d32);
      }

      .section .saved-panel p {
        margin: 0;
        color: var(--wa-color-text-normal);
      }

      .snippet {
        margin: var(--wa-space-2xs) 0 0;
        padding: var(--wa-space-xs);
        border-radius: var(--wa-border-radius-m);
        background: var(--wa-color-surface-lowered);
        font-family: var(--wa-font-family-code, monospace);
        font-size: var(--wa-font-size-xs);
        white-space: pre;
        overflow-x: auto;
      }
    `,
  ];

  open(target: TroubleshootTarget): void {
    // Key on the configuration and derive the device name from the
    // catalog: senders variously hold the friendly name, and the
    // reachability subscription needs the esphome name.
    this._configuration = target.configuration;
    this._result = null;
    this._checkFailed = false;
    this._reachability = null;
    // An effective address that isn't the default `<name>.local` is an
    // existing use_address; surface and prefill it so a stale one gets
    // updated rather than silently kept.
    const device = this._devices.find((d) => d.configuration === target.configuration);
    this._name = device?.name ?? "";
    this._existingAddress =
      device && device.address && device.address !== `${device.name}.local`
        ? device.address
        : "";
    this._addressInput = this._existingAddress;
    this._addressInvalid = false;
    this._saveState = "idle";
    this._screen = "main";
    this._dialog.open = true;
    if (this._name) void this._subscribe(this._name);
    void this._runCheck();
  }

  close(): void {
    this._dialog.open = false;
  }

  protected render() {
    const device = this._devices.find((d) => d.configuration === this._configuration);
    const onAddressScreen = this._screen === "address";
    const friendly = device?.friendly_name || this._name;
    const label = onAddressScreen
      ? this._localize("troubleshoot.use_address_title")
      : friendly
        ? this._localize("troubleshoot.title_device", { name: friendly })
        : this._localize("troubleshoot.title");
    return html`
      <esphome-base-dialog
        ?open=${this._dialog.open}
        .label=${label}
        @request-close=${this._dialog.onRequestClose}
        @after-hide=${this._onAfterHide}
      >
        ${
          onAddressScreen
            ? html`<button
                slot="header-prefix"
                class="back-button"
                aria-label=${this._localize("troubleshoot.back")}
                @click=${() => {
                  this._screen = "main";
                }}
              >
                <wa-icon library="mdi" name="arrow-left"></wa-icon>
              </button>`
            : nothing
        }
        ${
          onAddressScreen
            ? this._renderAddressScreen(device)
            : html`
                ${this._renderProbeSummary()}
                ${device ? this._renderSections(device) : nothing}
                <div class="actions">
                  <button class="btn btn--cancel" @click=${this.close}>
                    ${this._localize("layout.close")}
                  </button>
                  <button
                    class="btn btn--confirm"
                    ?disabled=${this._checking}
                    @click=${() => void this._runCheck()}
                  >
                    ${this._localize("troubleshoot.check_again")}
                  </button>
                </div>
              `
        }
      </esphome-base-dialog>
    `;
  }

  private _renderProbeSummary(): TemplateResult {
    if (this._checking && this._result === null) {
      return html`<div class="checking">
        <wa-spinner></wa-spinner>
        ${this._localize("troubleshoot.checking")}
      </div>`;
    }
    if (this._checkFailed) {
      return html`<div class="probe-rows">
        ${this._probeRow("fail", this._localize("troubleshoot.check_failed"))}
      </div>`;
    }
    const r = this._result;
    if (r === null) return html``;
    const list = (ips: string[]) => ips.join(", ");
    return html`<div class="probe-rows">
      ${
        isIpLiteral(r.address)
          ? this._probeRow(
              "neutral",
              this._localize("troubleshoot.result_manual_address", {
                address: r.address,
              })
            )
          : r.dns_resolved
            ? this._probeRow(
                "ok",
                this._localize("troubleshoot.result_dns_ok", {
                  address: r.address,
                  ips: list(r.dns_addresses),
                })
              )
            : this._probeRow(
                "fail",
                this._localize("troubleshoot.result_dns_fail", { address: r.address })
              )
      }
      ${
        !r.zeroconf_running
          ? this._probeRow("fail", this._localize("troubleshoot.result_mdns_off"))
          : r.mdns_addresses.length > 0
            ? this._probeRow(
                "ok",
                this._localize("troubleshoot.result_mdns_ok", {
                  ips: list(r.mdns_addresses),
                })
              )
            : this._probeRow("fail", this._localize("troubleshoot.result_mdns_silent"))
      }
      ${this._renderPingRow(r)}
    </div>`;
  }

  private _renderPingRow(r: DeviceTroubleshootResult): TemplateResult {
    if (!r.ping_attempted) {
      if (r.icmp_available === false) {
        return this._probeRow(
          "neutral",
          this._localize("troubleshoot.result_ping_unavailable")
        );
      }
      if (r.icmp_available === null) {
        return this._probeRow(
          "neutral",
          this._localize("troubleshoot.result_ping_probing")
        );
      }
      return this._probeRow(
        "neutral",
        this._localize("troubleshoot.result_ping_skipped")
      );
    }
    if (r.ping_rtt_ms !== null) {
      return this._probeRow(
        "ok",
        this._localize("troubleshoot.result_ping_ok", {
          target: r.ping_target,
          rtt: r.ping_rtt_ms.toFixed(1),
        })
      );
    }
    return this._probeRow(
      "fail",
      this._localize("troubleshoot.result_ping_fail", { target: r.ping_target })
    );
  }

  private _probeRow(kind: "ok" | "fail" | "neutral", text: string): TemplateResult {
    const icon =
      kind === "ok"
        ? "check-circle"
        : kind === "fail"
          ? "close-circle"
          : "help-circle-outline";
    return html`<div class="probe-row ${kind}">
      <wa-icon library="mdi" name=${icon}></wa-icon>
      <span>${text}</span>
    </div>`;
  }

  private _renderSections(device: ConfiguredDevice): TemplateResult {
    const sections = buildTroubleshootSections({
      device,
      reachability: this._reachability,
      result: this._result,
      inDocker: this._api?.serverInfo?.in_docker === true,
      existingAddress: this._existingAddress,
    });
    // The device row knows the effective address before the probe answers.
    const address = this._result?.address || device.address;
    return html`${sections.map((section) => {
      // The manual-address fix is the last resort: a drill row into its
      // own screen, so the diagnosis stays compact on small viewports.
      if (section.showUseAddressForm) {
        return html`
          <button
            class="drill"
            data-section=${section.id}
            @click=${() => {
              this._screen = "address";
            }}
          >
            <span>${this._localize(section.titleKey)}</span>
            <wa-icon library="mdi" name="chevron-right"></wa-icon>
          </button>
        `;
      }
      return html`
        <div class="section" data-section=${section.id}>
          <h3>${this._localize(section.titleKey)}</h3>
          ${section.bodyKeys.map(
            (key) => html`<p>${this._localize(key, { address })}</p>`
          )}
          ${
            section.docsUrl
              ? html`<a href=${section.docsUrl} target="_blank" rel="noopener noreferrer">
                  ${this._localize("troubleshoot.learn_more")}
                  <wa-icon library="mdi" name="open-in-new"></wa-icon>
                </a>`
              : nothing
          }
        </div>
      `;
    })}`;
  }

  private _renderAddressScreen(device: ConfiguredDevice | undefined): TemplateResult {
    if (this._saveState === "saved") {
      return html`
        <div class="section" data-section="use_address">
          <div class="saved-panel">
            <wa-icon library="mdi" name="check-circle"></wa-icon>
            <p>${this._localize("troubleshoot.use_address_saved")}</p>
          </div>
          <div class="actions">
            <button class="btn btn--confirm" @click=${this.close}>
              ${this._localize("layout.close")}
            </button>
          </div>
        </div>
      `;
    }
    return html`
      <div class="section" data-section="use_address">
        <p>
          ${this._localize("troubleshoot.use_address_body")}
          <a href=${USE_ADDRESS_DOCS_URL} target="_blank" rel="noopener noreferrer">
            ${this._localize("troubleshoot.learn_more")}
            <wa-icon library="mdi" name="open-in-new"></wa-icon>
          </a>
        </p>
        <p class="warning-banner">
          ${this._localize("troubleshoot.use_address_ownership")}
        </p>
        ${device ? this._renderUseAddressForm(device) : nothing}
      </div>
    `;
  }

  private _renderUseAddressForm(device: ConfiguredDevice): TemplateResult {
    if (this._saveState === "snippet") {
      const section = snippetNetworkSection(
        this._snippetYaml,
        device.loaded_integrations
      );
      return html`
        <p>${this._localize("troubleshoot.use_address_snippet")}</p>
        <pre class="snippet">
${section}:
  use_address: ${this._addressInput.trim()}</pre>
      `;
    }
    const placeholder = device.ip || this._result?.ping_target || "192.168.1.50";
    return html`
      <label class="address-label" for="use-address-input">
        <code>use_address</code>
        <span>${this._localize("troubleshoot.use_address_label")}</span>
      </label>
      <div class="address-form">
        <input
          id="use-address-input"
          type="text"
          class=${this._addressInvalid ? "invalid" : ""}
          .value=${this._addressInput}
          placeholder=${placeholder}
          @input=${(e: Event) => {
            this._addressInput = (e.target as HTMLInputElement).value;
            this._addressInvalid = false;
          }}
          @keydown=${(e: KeyboardEvent) => {
            if (e.key === "Enter") void this._saveUseAddress();
          }}
        />
      </div>
      ${
        this._addressInvalid
          ? html`<p class="field-error">
              ${this._localize("troubleshoot.use_address_invalid")}
            </p>`
          : nothing
      }
      ${
        this._saveState === "error"
          ? html`<p class="field-error">
              ${this._localize("troubleshoot.use_address_error")}
            </p>`
          : nothing
      }
      <div class="actions">
        <button
          class="btn btn--confirm"
          ?disabled=${this._saveState === "saving"}
          @click=${() => void this._saveUseAddress()}
        >
          ${this._localize("troubleshoot.use_address_save")}
        </button>
      </div>
    `;
  }

  private async _runCheck(): Promise<void> {
    const configuration = this._configuration;
    this._checking = true;
    this._checkFailed = false;
    try {
      const result = await this._api.troubleshootDevice(configuration);
      if (configuration !== this._configuration) return;
      this._result = result;
    } catch {
      if (configuration !== this._configuration) return;
      this._checkFailed = true;
    } finally {
      if (configuration === this._configuration) this._checking = false;
    }
  }

  private async _subscribe(name: string): Promise<void> {
    try {
      const subscription = await this._api.subscribeDeviceReachability(name, (event) => {
        if (name === this._name) this._reachability = event;
      });
      if (name !== this._name || !this._dialog.open) {
        void subscription.unsubscribe();
        return;
      }
      this._subscription = subscription;
    } catch {
      // Advice degrades to device flags + probe result without the stream.
    }
  }

  private async _saveUseAddress(): Promise<void> {
    const value = this._addressInput.trim();
    if (!isValidUseAddress(value)) {
      this._addressInvalid = true;
      return;
    }
    this._saveState = "saving";
    try {
      const yaml = await this._api.getConfig(this._configuration);
      const updated = applyUseAddress(yaml, value);
      if (updated === null) {
        this._snippetYaml = yaml;
        this._saveState = "snippet";
        return;
      }
      await this._api.updateConfig(this._configuration, updated);
      this._saveState = "saved";
    } catch {
      this._saveState = "error";
    }
  }

  protected updated(changed: PropertyValues): void {
    if (changed.has("_screen") && this._screen === "address") {
      this.renderRoot.querySelector<HTMLInputElement>(".address-form input")?.focus();
    }
  }

  private _onAfterHide = (): void => {
    this._dialog.open = false;
    this._screen = "main";
    if (this._subscription !== null) {
      const sub = this._subscription;
      this._subscription = null;
      void sub.unsubscribe();
    }
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-troubleshoot-dialog": ESPHomeTroubleshootDialog;
  }
}
