import { consume } from "@lit/context";
import { mdiDownload, mdiEyeOffOutline, mdiEyeOutline } from "@mdi/js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { AdoptableDevice } from "../api/types.js";
import type { LocalizeFunc } from "../common/localize.js";
import { localizeContext } from "../context/index.js";
import { espHomeStyles } from "../styles/shared.js";
import { registerMdiIcons } from "../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({
  download: mdiDownload,
  "eye-off-outline": mdiEyeOffOutline,
  "eye-outline": mdiEyeOutline,
});

@customElement("esphome-discovered-device-card")
export class ESPHomeDiscoveredDeviceCard extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @property({ attribute: false })
  device!: AdoptableDevice;

  static styles = [
    espHomeStyles,
    css`
      :host {
        display: block;
      }

      .card {
        position: relative;
        border-radius: var(--wa-border-radius-l);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        background: var(--wa-color-surface-raised);
        display: flex;
        flex-direction: column;
        transition: box-shadow 0.15s;
      }

      .card:hover {
        box-shadow: var(--wa-shadow-m);
      }

      .card[data-ignored] {
        opacity: 0.6;
      }

      /* Status ribbon — green for fresh discoveries, neutral for
         ignored ones. Mirrors the legacy dashboard's "DISCOVERED" /
         "IGNORED DISCOVERY" pill so users get a consistent reading
         of the device's state at a glance. */
      .status {
        position: absolute;
        top: -8px;
        left: var(--wa-space-m);
        padding: 2px 8px;
        border-radius: 999px;
        font-size: var(--wa-font-size-2xs);
        font-weight: var(--wa-font-weight-bold);
        letter-spacing: 0.04em;
        text-transform: uppercase;
        background: var(--esphome-success);
        color: var(--esphome-on-primary);
      }
      .card[data-ignored] .status {
        background: var(--wa-color-surface-lowered);
        color: var(--wa-color-text-quiet);
      }

      .header {
        padding: var(--wa-space-m) var(--wa-space-m) var(--wa-space-s);
        border-bottom: var(--wa-border-width-s) solid var(--wa-color-surface-border);
      }

      .title {
        margin: 0 0 var(--wa-space-2xs);
        font-size: var(--wa-font-size-m);
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
      }

      .hostname {
        font-family:
          "SFMono-Regular", Consolas, "Liberation Mono", Menlo, Courier,
          monospace;
        font-size: var(--wa-font-size-2xs);
        background: var(--wa-color-surface-lowered);
        border-radius: var(--wa-border-radius-s);
        padding: 1px 6px;
      }

      .actions {
        display: flex;
        align-items: center;
        gap: var(--wa-space-2xs);
        padding: var(--wa-space-s) var(--wa-space-m);
      }

      .btn {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 5px 12px;
        border-radius: var(--wa-border-radius-m);
        font-size: var(--wa-font-size-xs);
        font-weight: var(--wa-font-weight-bold);
        font-family: inherit;
        cursor: pointer;
        border: var(--wa-border-width-s) solid transparent;
        transition:
          background 0.12s,
          border-color 0.12s;
      }

      .btn--primary {
        background: var(--esphome-success);
        color: var(--esphome-on-primary);
      }

      .btn--primary:hover {
        background: color-mix(in srgb, var(--esphome-success), black 10%);
      }

      .btn--ghost {
        background: transparent;
        color: var(--wa-color-text-normal);
        border-color: var(--wa-color-surface-border);
        margin-left: auto;
      }

      .btn--ghost:hover {
        background: var(--wa-color-surface-lowered);
      }

      .btn wa-icon {
        font-size: 15px;
      }
    `,
  ];

  protected render() {
    const title = this.device.friendly_name || this.device.name;
    const showHostname = !!this.device.friendly_name;
    return html`
      <div class="card" ?data-ignored=${this.device.ignored}>
        <span class="status">
          ${this.device.ignored
            ? this._localize("dashboard.discovered_ignored")
            : this._localize("dashboard.discovered_status")}
        </span>
        <div class="header">
          <h3 class="title">${title}</h3>
          <div class="subtitle">
            ${showHostname
              ? html`<span class="hostname">${this.device.name}</span> · `
              : nothing}
            ${this.device.project_name}${this.device.project_version
              ? html` <span>${this.device.project_version}</span>`
              : nothing}
          </div>
        </div>
        <div class="actions">
          ${this.device.ignored
            ? nothing
            : html`
                <button
                  class="btn btn--primary"
                  @click=${() => this._emit("adopt")}
                >
                  <wa-icon library="mdi" name="download"></wa-icon>
                  ${this._localize("dashboard.action_take_control")}
                </button>
              `}
          <button
            class="btn btn--ghost"
            title=${this._localize(
              this.device.ignored
                ? "dashboard.action_unignore"
                : "dashboard.action_ignore",
            )}
            @click=${() => this._emit("toggle-ignore")}
          >
            <wa-icon
              library="mdi"
              name=${this.device.ignored ? "eye-outline" : "eye-off-outline"}
            ></wa-icon>
            ${this._localize(
              this.device.ignored
                ? "dashboard.action_unignore"
                : "dashboard.action_ignore",
            )}
          </button>
        </div>
      </div>
    `;
  }

  private _emit(name: string) {
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
    "esphome-discovered-device-card": ESPHomeDiscoveredDeviceCard;
  }
}
