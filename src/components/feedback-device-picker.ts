import { consume } from "@lit/context";
import { mdiBugOutline, mdiChip, mdiClipboardTextOutline, mdiOpenInNew } from "@mdi/js";
import { css, html, LitElement, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { ESPHomeAPI } from "../api/index.js";
import type { ConfiguredDevice } from "../api/types/devices.js";
import type { LocalizeFunc } from "../common/localize.js";
import {
  apiContext,
  devicesContext,
  isHaAddonContext,
  localizeContext,
  serverVersionContext,
  versionContext,
} from "../context/index.js";
import { inputStyles } from "../styles/inputs.js";
import { espHomeStyles } from "../styles/shared.js";
import { summaryListStyles } from "../styles/summary-list.js";
import {
  buildDeviceIssueUrl,
  type DeviceTarget,
  type PrefillContext,
  skipDeviceUrl,
} from "../util/bug-report-prefill.js";
import { matchesDeviceName } from "../util/device-search.js";
import { deviceSortKey, sortDevices } from "../util/device-sort.js";
import { detectInstallation } from "../util/installation.js";
import { captureMaskedConfig } from "../util/masked-config-capture.js";
import { notifyError } from "../util/notify.js";
import { registerMdiIcons } from "../util/register-icons.js";
import { feedbackLinkStyles } from "./feedback-link.styles.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/spinner/spinner.js";

registerMdiIcons({
  "bug-outline": mdiBugOutline,
  chip: mdiChip,
  "clipboard-text-outline": mdiClipboardTextOutline,
  "open-in-new": mdiOpenInNew,
});

// Fleets larger than this get a filter input above the device rows.
const DEVICE_FILTER_THRESHOLD = 8;

/**
 * The feedback dialog's device screen: pick the device a bug report is
 * about and open the target GitHub form prefilled with its masked
 * config. Fires ``picker-close`` when the dialog should close (the
 * skip row and the ready-state link, both inside a click gesture).
 */
@customElement("esphome-feedback-device-picker")
export class ESPHomeFeedbackDevicePicker extends LitElement {
  /** Which bug path the picked device prefills for. */
  @property({ attribute: false })
  public target: DeviceTarget = "builder";

  /** False once the surrounding dialog started closing, so an in-flight
   *  capture can't open a tab during the hide animation (the element
   *  only disconnects at after-hide). */
  @property({ attribute: false })
  public active = true;

  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: serverVersionContext, subscribe: true })
  @state()
  private _serverVersion = "";

  @consume({ context: versionContext, subscribe: true })
  @state()
  private _esphomeVersion = "";

  @consume({ context: apiContext })
  private _api!: ESPHomeAPI;

  @consume({ context: devicesContext, subscribe: true })
  @state()
  private _devices: ConfiguredDevice[] = [];

  @consume({ context: isHaAddonContext, subscribe: true })
  @state()
  private _isHaAddon = false;

  @state()
  private _filter = "";

  // The configuration whose config capture is in flight ("" = none);
  // drives the per-row spinner and blocks double-picks.
  @state()
  private _capturing = "";

  // The prefilled form URL once a capture settled; the screen then
  // shows the guaranteed link (the auto-open may be popup-blocked).
  @state()
  private _readyUrl = "";

  // A capture from a previous pick must not open a form for this one.
  // The element is created fresh per screen entry, so leaving the
  // screen (or closing the dialog) abandons via disconnection.
  private _session = 0;

  // Sorted copy of the fleet, recomputed only when the devices array is
  // replaced, so filter keystrokes and device events pay no re-sort.
  private _sortedDevices: ConfiguredDevice[] = [];

  static styles = [
    espHomeStyles,
    // Project-wide native-input look for the device filter.
    inputStyles,
    summaryListStyles,
    feedbackLinkStyles,
    css`
      /* Look comes from the shared inputStyles; only layout here. */
      .device-filter {
        width: 100%;
        box-sizing: border-box;
        margin: 0 0 var(--wa-space-s);
      }

      .device-list {
        max-height: 320px;
        overflow-y: auto;
      }

      /* The lead-in that anchors the what-is-included rows below it. */
      .summary-heading {
        margin: 0 0 var(--wa-space-2xs);
        font-size: var(--wa-font-size-s);
        color: var(--wa-color-text-normal);
      }
    `,
  ];

  protected willUpdate(changed: PropertyValues): void {
    if (changed.has("_devices")) this._sortedDevices = sortDevices(this._devices);
  }

  // The ready swap removes the focused device row; move focus to the
  // anchor so keyboard and screen-reader users aren't dropped to body.
  protected updated(changed: PropertyValues): void {
    if (changed.has("_readyUrl") && this._readyUrl) {
      this.renderRoot.querySelector<HTMLElement>("a.link")?.focus();
    }
  }

  protected render() {
    if (this._readyUrl) {
      return html`
        <p class="description" role="status">
          ${this._localize("feedback.device_ready")}
        </p>
        <div class="links">
          <a
            class="link featured"
            href=${this._readyUrl}
            target="_blank"
            rel="noopener noreferrer"
            @click=${this._requestClose}
          >
            <wa-icon class="link-icon" library="mdi" name="open-in-new"></wa-icon>
            <span class="link-text">
              <span class="link-label">${this._localize("feedback.open_form")}</span>
            </span>
            <wa-icon class="link-external" library="mdi" name="open-in-new"></wa-icon>
          </a>
        </div>
      `;
    }
    const filter = this._filter.trim().toLowerCase();
    const devices = this._sortedDevices.filter(
      (device) => !filter || matchesDeviceName(device, filter)
    );
    return html`
      <p class="summary-heading">${this._localize("feedback.device_includes_heading")}</p>
      <ul class="summary">
        ${["feedback.device_includes_config", "feedback.device_includes_facts"].map(
          (key) => html`
            <li>
              <wa-icon library="mdi" name="clipboard-text-outline"></wa-icon>
              <span>${this._localize(key)}</span>
            </li>
          `
        )}
      </ul>
      <p class="description">${this._localize("feedback.device_hint")}</p>
      ${
        this._devices.length > DEVICE_FILTER_THRESHOLD
          ? html`<input
              class="device-filter"
              type="search"
              aria-label=${this._localize("feedback.device_filter")}
              placeholder=${this._localize("feedback.device_filter")}
              .value=${this._filter}
              @input=${this._onFilterInput}
            />`
          : ""
      }
      <div class="links device-list">
        <button class="link" @click=${this._skipDevice}>
          <wa-icon class="link-icon" library="mdi" name="bug-outline"></wa-icon>
          <span class="link-text">
            <span class="link-label">${this._localize("feedback.device_skip")}</span>
          </span>
          <wa-icon class="link-external" library="mdi" name="open-in-new"></wa-icon>
        </button>
        ${
          devices.length === 0 && filter
            ? html`<p class="description" role="status">
                ${this._localize("feedback.device_no_matches")}
              </p>`
            : ""
        }
        ${devices.map((device) => this._renderDeviceRow(device))}
      </div>
    `;
  }

  private _renderDeviceRow(device: ConfiguredDevice) {
    const busy = this._capturing === device.configuration;
    return html`
      <button
        class="link"
        ?disabled=${this._capturing !== "" && !busy}
        @click=${() => this._pickDevice(device)}
      >
        <wa-icon class="link-icon" library="mdi" name="chip"></wa-icon>
        <span class="link-text">
          <span class="link-label">${deviceSortKey(device)}</span>
          <span class="link-desc">${device.configuration}</span>
        </span>
        ${
          busy
            ? html`<wa-spinner></wa-spinner>`
            : html`<wa-icon
                class="link-external"
                library="mdi"
                name="open-in-new"
              ></wa-icon>`
        }
      </button>
    `;
  }

  private _prefillContext(): PrefillContext {
    return {
      serverVersion: this._serverVersion,
      esphomeVersion: this._esphomeVersion,
      installation: detectInstallation(this._api, this._isHaAddon),
    };
  }

  // The skip row runs inside the click gesture, so the popup is never
  // blocked and the dialog can close right away.
  private _skipDevice = (): void => {
    window.open(
      skipDeviceUrl(this.target, this._prefillContext()).toString(),
      "_blank",
      "noopener,noreferrer"
    );
    this._requestClose();
  };

  private async _pickDevice(device: ConfiguredDevice): Promise<void> {
    if (this._capturing) return;
    const session = ++this._session;
    this._capturing = device.configuration;
    const abandoned = () =>
      session !== this._session || !this.isConnected || !this.active;
    const masked = await captureMaskedConfig(this._api, device.configuration, abandoned);
    if (abandoned()) return;
    this._capturing = "";
    if (masked === null) return;
    if (masked === "") {
      // The form still opens with the facts; the config just isn't in it.
      notifyError(this._localize("feedback.device_capture_failed"));
    }
    const url = buildDeviceIssueUrl(
      this.target,
      device,
      masked,
      this._prefillContext()
    ).toString();
    // The capture can outlive the click's transient activation, so the
    // auto-open may be silently popup-blocked (window.open with noopener
    // returns null by spec either way — blocking is undetectable). Keep
    // the screen up with the link as the guaranteed path.
    this._readyUrl = url;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  private _onFilterInput = (e: Event): void => {
    this._filter = (e.target as HTMLInputElement).value;
  };

  private _requestClose = (): void => {
    this.dispatchEvent(new Event("picker-close", { bubbles: true, composed: true }));
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-feedback-device-picker": ESPHomeFeedbackDevicePicker;
  }
}
