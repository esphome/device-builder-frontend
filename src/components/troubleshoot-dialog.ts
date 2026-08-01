/**
 * Offline troubleshooting dialog, opened from the status badge on the
 * device card, table row, and drawer. Auto-runs the backend's
 * `devices/troubleshoot` probe on open, renders the concrete results
 * plus device-specific advice (`util/troubleshoot-tree.ts`), and ends
 * with the manual `use_address` fix (`util/use-address-yaml.ts`).
 */
import { consume } from "@lit/context";
import {
  mdiCheckCircle,
  mdiCloseCircle,
  mdiHelpCircleOutline,
  mdiOpenInNew,
} from "@mdi/js";
import { css, html, LitElement, nothing, type TemplateResult } from "lit";
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
import { modalDialogStyles } from "../styles/modal-dialog.js";
import { espHomeStyles } from "../styles/shared.js";
import { DialogOpenController } from "../util/dialog-open-controller.js";
import { registerMdiIcons } from "../util/register-icons.js";
import { buildTroubleshootSections } from "../util/troubleshoot-tree.js";
import { applyUseAddress, isValidUseAddress } from "../util/use-address-yaml.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/spinner/spinner.js";
import "./base-dialog.js";

registerMdiIcons({
  "check-circle": mdiCheckCircle,
  "close-circle": mdiCloseCircle,
  "help-circle-outline": mdiHelpCircleOutline,
  "open-in-new": mdiOpenInNew,
});

export interface TroubleshootTarget {
  name: string;
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

  private _subscription: ReachabilitySubscription | null = null;

  static styles = [
    espHomeStyles,
    modalDialogStyles,
    css`
      :host {
        display: contents;
      }

      esphome-base-dialog {
        --width: 520px;
      }

      .subtitle {
        margin: 0 0 var(--wa-space-m);
        font-size: var(--wa-font-size-s);
        color: var(--wa-color-text-quiet);
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

      .section p {
        margin: 0 0 var(--wa-space-2xs);
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

      .address-form {
        display: flex;
        gap: var(--wa-space-xs);
        margin-top: var(--wa-space-2xs);
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

      .saved-note {
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
    this._name = target.name;
    this._configuration = target.configuration;
    this._result = null;
    this._checkFailed = false;
    this._reachability = null;
    this._addressInput = "";
    this._addressInvalid = false;
    this._saveState = "idle";
    this._dialog.open = true;
    void this._subscribe(target.name);
    void this._runCheck();
  }

  close(): void {
    this._dialog.open = false;
  }

  protected render() {
    const device = this._devices.find((d) => d.configuration === this._configuration);
    return html`
      <esphome-base-dialog
        ?open=${this._dialog.open}
        .label=${this._localize("troubleshoot.title")}
        @request-close=${this._dialog.onRequestClose}
        @after-hide=${this._onAfterHide}
      >
        <p class="subtitle">${this._name} &middot; ${this._configuration}</p>
        ${this._renderProbeSummary()} ${device ? this._renderSections(device) : nothing}
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
        r.dns_resolved
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
    });
    return html`${sections.map(
      (section) => html`
        <div class="section" data-section=${section.id}>
          <h3>${this._localize(section.titleKey)}</h3>
          ${section.bodyKeys.map(
            (key) =>
              html`<p>
                ${this._localize(key, { address: this._result?.address ?? "" })}
              </p>`
          )}
          ${
            section.docsUrl
              ? html`<a href=${section.docsUrl} target="_blank" rel="noopener noreferrer">
                  ${this._localize("troubleshoot.learn_more")}
                  <wa-icon library="mdi" name="open-in-new"></wa-icon>
                </a>`
              : nothing
          }
          ${section.showUseAddressForm ? this._renderUseAddressForm(device) : nothing}
        </div>
      `
    )}`;
  }

  private _renderUseAddressForm(device: ConfiguredDevice): TemplateResult {
    if (this._saveState === "saved") {
      return html`<p class="saved-note">
        ${this._localize("troubleshoot.use_address_saved")}
      </p>`;
    }
    if (this._saveState === "snippet") {
      return html`
        <p>${this._localize("troubleshoot.use_address_snippet")}</p>
        <pre class="snippet">
wifi:
  use_address: ${this._addressInput.trim()}</pre>
      `;
    }
    const placeholder = device.ip || this._result?.ping_target || "192.168.1.50";
    return html`
      <div class="address-form">
        <input
          type="text"
          class=${this._addressInvalid ? "invalid" : ""}
          .value=${this._addressInput}
          placeholder=${placeholder}
          aria-label=${this._localize("troubleshoot.use_address_label")}
          @input=${(e: Event) => {
            this._addressInput = (e.target as HTMLInputElement).value;
            this._addressInvalid = false;
          }}
          @keydown=${(e: KeyboardEvent) => {
            if (e.key === "Enter") void this._saveUseAddress();
          }}
        />
        <button
          class="btn btn--confirm"
          ?disabled=${this._saveState === "saving"}
          @click=${() => void this._saveUseAddress()}
        >
          ${this._localize("troubleshoot.use_address_save")}
        </button>
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
        this._saveState = "snippet";
        return;
      }
      await this._api.updateConfig(this._configuration, updated);
      this._saveState = "saved";
    } catch {
      this._saveState = "error";
    }
  }

  private _onAfterHide = (): void => {
    this._dialog.open = false;
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
