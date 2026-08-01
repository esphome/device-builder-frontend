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
import { html, LitElement, nothing, type PropertyValues, type TemplateResult } from "lit";
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
  pingReplyUnverified,
} from "../util/troubleshoot-tree.js";
import { isIpLiteral, type NetworkSection } from "../util/use-address-yaml.js";
import { troubleshootDialogStyles } from "./troubleshoot-dialog.styles.js";
import {
  loadExistingAddress,
  renderAddressScreen,
} from "./troubleshoot-dialog/address-screen.js";

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

const PROBE_ROW_ICONS = {
  ok: "check-circle",
  fail: "close-circle",
  neutral: "help-circle-outline",
} as const;

type SaveState =
  "idle" | "saving" | "saved" | "removed" | "remove_packaged" | "snippet" | "error";

@customElement("esphome-troubleshoot-dialog")
export class ESPHomeTroubleshootDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  _localize: LocalizeFunc = (key) => key;

  @consume({ context: apiContext })
  _api!: ESPHomeAPI;

  @consume({ context: devicesContext, subscribe: true })
  @state()
  _devices: ConfiguredDevice[] = [];

  private readonly _dialog = new DialogOpenController(this);

  @state() private _name = "";
  @state() _configuration = "";
  @state() _result: DeviceTroubleshootResult | null = null;
  @state() private _checking = false;
  @state() private _checkFailed = false;
  @state() private _reachability: ReachabilityStateEvent | null = null;
  @state() _addressInput = "";
  @state() _addressInvalid = false;
  @state() _saveState: SaveState = "idle";
  @state() private _screen: "main" | "address" = "main";
  @state() _existingAddress = "";

  private _subscription: ReachabilitySubscription | null = null;
  _snippetSection: NetworkSection = "wifi";
  private _reconcileTimer: ReturnType<typeof setInterval> | null = null;
  private _subscribedGeneration = -1;
  private _failedGeneration = -1;
  private _subscribePending = false;

  static styles = [
    espHomeStyles,
    modalDialogStyles,
    warningBannerStyles,
    troubleshootDialogStyles,
  ];

  open(target: TroubleshootTarget): void {
    // Key on the configuration and derive the device name from the
    // catalog: senders variously hold the friendly name, and the
    // reachability subscription needs the esphome name.
    this._configuration = target.configuration;
    this._result = null;
    this._checkFailed = false;
    this._reachability = null;
    // An effective address that isn't the default `<name>.local` is a
    // hint (use_address, or a custom wifi `domain:`); it prefills the
    // form only. The diagnosis-driving `_existingAddress` is set solely
    // from the verified YAML read below, so a packaged config with a
    // custom domain can't fake "a manual address is set" and suppress
    // the real mDNS advice.
    const device = this._devices.find((d) => d.configuration === target.configuration);
    this._name = device?.name ?? "";
    this._existingAddress = "";
    this._addressInput =
      device && device.address && device.address !== `${device.name}.local`
        ? device.address
        : "";
    this._addressInvalid = false;
    this._saveState = "idle";
    this._screen = "main";
    this._teardownSubscription();
    // A reopen is an explicit retry; don't carry a failed-subscribe gate.
    this._failedGeneration = -1;
    this._dialog.open = true;
    this._startReconcile();
    void loadExistingAddress(this);
    void this._runCheck();
  }

  close(): void {
    this._dialog.open = false;
  }

  protected render() {
    const device = this._dialog.open
      ? this._devices.find((d) => d.configuration === this._configuration)
      : undefined;
    const onAddressScreen = this._screen === "address";
    const friendly = device?.friendly_name || this._name;
    const label = onAddressScreen
      ? friendly
        ? this._localize("troubleshoot.use_address_title_device", { name: friendly })
        : this._localize("troubleshoot.use_address_title")
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
                  this._saveState = "idle";
                  this._screen = "main";
                }}
              >
                <wa-icon library="mdi" name="arrow-left"></wa-icon>
              </button>`
            : nothing
        }
        ${
          onAddressScreen
            ? renderAddressScreen(this, device)
            : html`
                ${this._renderProbeSummary(device)}
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

  private _renderProbeSummary(device: ConfiguredDevice | undefined): TemplateResult {
    // Also replaces stale rows during a re-check, so Check again
    // visibly does something.
    if (this._checking) {
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
    return html`<div class="probe-rows">
      ${this._renderDnsRow(r)} ${this._renderMdnsRow(r, device)} ${this._renderPingRow(r)}
    </div>`;
  }

  private _renderDnsRow(r: DeviceTroubleshootResult): TemplateResult {
    if (r.dns_inconclusive) {
      return this._probeRow(
        "neutral",
        this._localize("troubleshoot.result_dns_inconclusive")
      );
    }
    if (isIpLiteral(r.address)) {
      return this._probeRow(
        "neutral",
        this._localize("troubleshoot.result_manual_address", { address: r.address })
      );
    }
    if (r.dns_resolved) {
      return this._probeRow(
        "ok",
        this._localize("troubleshoot.result_dns_ok", {
          address: r.address,
          ips: r.dns_addresses.join(", "),
        })
      );
    }
    return this._probeRow(
      "fail",
      this._localize("troubleshoot.result_dns_fail", { address: r.address })
    );
  }

  private _renderMdnsRow(
    r: DeviceTroubleshootResult,
    device: ConfiguredDevice | undefined
  ): TemplateResult {
    if (r.mdns_inconclusive) {
      return this._probeRow(
        "neutral",
        this._localize("troubleshoot.result_mdns_inconclusive")
      );
    }
    if (device?.mdns_disabled) {
      return this._probeRow(
        "neutral",
        this._localize("troubleshoot.result_mdns_disabled")
      );
    }
    if (!r.zeroconf_running) {
      return this._probeRow("fail", this._localize("troubleshoot.result_mdns_off"));
    }
    if (r.mdns_addresses.length > 0) {
      return this._probeRow(
        "ok",
        this._localize("troubleshoot.result_mdns_ok", {
          ips: r.mdns_addresses.join(", "),
        })
      );
    }
    return this._probeRow("fail", this._localize("troubleshoot.result_mdns_silent"));
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
      // A reply at the last-known address proves something answers
      // there, not that it is this device; don't paint it green.
      if (pingReplyUnverified(r)) {
        return this._probeRow(
          "neutral",
          this._localize("troubleshoot.result_ping_ok_last_known", {
            target: r.ping_target,
            rtt: r.ping_rtt_ms.toFixed(1),
          })
        );
      }
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
    const icon = PROBE_ROW_ICONS[kind];
    return html`<div class="probe-row ${kind}">
      <wa-icon library="mdi" name=${icon}></wa-icon>
      <span>${text}</span>
    </div>`;
  }

  private _renderSections(device: ConfiguredDevice): TemplateResult {
    // Hold the advice until the first probe lands: the reachability
    // stream alone can paint a confident diagnosis the probe then
    // retracts. Re-checks keep the previous sections visible.
    if (this._checking && this._result === null) return html``;
    // The HA add-on is a Docker container too, but it already runs
    // host-network; bridge advice there would be wrong and unactionable.
    const info = this._api?.serverInfo;
    const sections = buildTroubleshootSections({
      device,
      reachability: this._reachability,
      result: this._result,
      inDocker: info?.in_docker === true && info.ha_addon !== true,
      existingAddress: this._existingAddress,
    });
    // The device row knows the effective address before the probe answers.
    const address = this._result?.address || device.address;
    const ip = this._result?.ping_target || device.ip;
    return html`${sections.map((section) => {
      // The manual-address fix is the last resort: a drill row into its
      // own screen, so the diagnosis stays compact on small viewports.
      if (section.showUseAddressForm) {
        return html`
          <button
            class="drill"
            data-section=${section.id}
            @click=${() => {
              this._saveState = "idle";
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
            (key) => html`<p>${this._localize(key, { address, ip })}</p>`
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

  // Reconcile the reachability stream once a second while open: the
  // API clears listeners on a WS drop, so a reconnect (generation bump)
  // or a failed initial subscribe needs a fresh attempt (same shape as
  // the drawer's reconcileSubscription).
  private _startReconcile(): void {
    this._stopReconcile();
    this._reconcileTimer = setInterval(() => this._reconcileSubscription(), 1000);
    this._reconcileSubscription();
  }

  private _stopReconcile(): void {
    if (this._reconcileTimer !== null) {
      clearInterval(this._reconcileTimer);
      this._reconcileTimer = null;
    }
  }

  private _reconcileSubscription(): void {
    // An in-flight subscribe must finish before another attempt, or
    // each 1Hz tick opens a fresh stream while the ack is pending.
    if (this._subscribePending) return;
    const generation = this._api?.connectionGeneration ?? 0;
    if (this._subscription !== null && generation === this._subscribedGeneration) return;
    if (this._subscription === null && generation === this._failedGeneration) return;
    this._teardownSubscription();
    if (this._name) void this._subscribe(this._name, generation);
  }

  private async _subscribe(name: string, generation: number): Promise<void> {
    this._subscribePending = true;
    this._subscribedGeneration = generation;
    try {
      const subscription = await this._api.subscribeDeviceReachability(name, (event) => {
        if (name === this._name) this._reachability = event;
      });
      if (name !== this._name || !this._dialog.open) {
        void subscription.unsubscribe();
        return;
      }
      this._subscription = subscription;
    } catch (err) {
      // Advice degrades to device flags + probe result without the
      // stream; one retry per connection generation.
      this._failedGeneration = generation;
      console.warn("subscribeDeviceReachability failed", err);
    } finally {
      this._subscribePending = false;
    }
  }

  protected updated(changed: PropertyValues): void {
    if (changed.has("_screen") && this._screen === "address") {
      this.renderRoot.querySelector<HTMLInputElement>(".address-form input")?.focus();
    }
  }

  private _teardownSubscription(): void {
    if (this._subscription !== null) {
      const sub = this._subscription;
      this._subscription = null;
      void sub.unsubscribe();
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._stopReconcile();
    this._teardownSubscription();
  }

  private _onAfterHide = (): void => {
    this._dialog.open = false;
    this._stopReconcile();
    this._teardownSubscription();
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-troubleshoot-dialog": ESPHomeTroubleshootDialog;
  }
}
