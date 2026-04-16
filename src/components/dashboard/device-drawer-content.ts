import { consume } from "@lit/context";
import {
  mdiFileDocumentOutline,
  mdiInformationOutline,
  mdiIpNetworkOutline,
  mdiMemory,
  mdiTagMultiple,
  mdiTextShort,
  mdiUpload,
} from "@mdi/js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { LocalizeFunc } from "../../common/localize.js";
import type { ConfiguredDevice } from "../../api/types.js";
import { localizeContext } from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import { registerMdiIcons } from "../../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({
  "file-document-outline": mdiFileDocumentOutline,
  "information-outline": mdiInformationOutline,
  "ip-network-outline": mdiIpNetworkOutline,
  memory: mdiMemory,
  "tag-multiple": mdiTagMultiple,
  "text-short": mdiTextShort,
  upload: mdiUpload,
});

@customElement("esphome-device-drawer-content")
export class ESPHomeDeviceDrawerContent extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @property({ attribute: false })
  device!: ConfiguredDevice;

  static styles = [
    espHomeStyles,
    css`
      :host {
        display: block;
      }

      .section {
        margin-bottom: var(--wa-space-l);
      }

      .section-title {
        font-size: var(--wa-font-size-2xs);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-quiet);
        text-transform: uppercase;
        letter-spacing: 0.06em;
        margin: 0 0 var(--wa-space-s);
        padding-bottom: var(--wa-space-xs);
        border-bottom: var(--wa-border-width-s) solid
          var(--wa-color-surface-border);
      }

      .row {
        display: flex;
        align-items: flex-start;
        gap: var(--wa-space-s);
        padding: var(--wa-space-xs) 0;
      }

      .row + .row {
        border-top: var(--wa-border-width-s) solid
          color-mix(in srgb, var(--wa-color-surface-border), transparent 50%);
      }

      .icon {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        border-radius: var(--wa-border-radius-m);
        background: color-mix(
          in srgb,
          var(--esphome-primary),
          transparent 90%
        );
        flex-shrink: 0;
        margin-top: 2px;
      }

      .icon wa-icon {
        font-size: 16px;
        color: var(--esphome-primary);
      }

      .content {
        flex: 1;
        min-width: 0;
      }

      .label {
        font-size: var(--wa-font-size-2xs);
        color: var(--wa-color-text-quiet);
        margin-bottom: 2px;
      }

      .value {
        font-size: var(--wa-font-size-s);
        color: var(--wa-color-text-normal);
        word-break: break-word;
      }

      .value.mono {
        font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas,
          monospace;
        font-size: var(--wa-font-size-xs);
      }

      .value.muted {
        color: var(--wa-color-text-quiet);
        font-style: italic;
      }

      .tags-wrap {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 4px;
      }

      .tag {
        display: inline-flex;
        padding: 3px 10px;
        border-radius: var(--wa-border-radius-m);
        font-size: var(--wa-font-size-2xs);
        font-weight: var(--wa-font-weight-bold);
        background: var(--wa-color-surface-lowered);
        color: var(--wa-color-text-quiet);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
      }
    `,
  ];

  protected render() {
    const d = this.device;
    if (!d) return nothing;

    return html`
      <div class="section">
        <h4 class="section-title">${this._localize("dashboard.drawer_device_info")}</h4>
        ${this._row("information-outline", this._localize("dashboard.drawer_name"), d.friendly_name || d.name)}
        ${this._row("ip-network-outline", this._localize("dashboard.drawer_ip_address"), d.address, true)}
        ${this._row("memory", this._localize("dashboard.drawer_platform"), d.target_platform)}
      </div>

      <div class="section">
        <h4 class="section-title">${this._localize("dashboard.drawer_version")}</h4>
        ${this._row("tag-multiple", this._localize("dashboard.drawer_current_version"), d.current_version, true)}
        ${this._row("upload", this._localize("dashboard.drawer_deployed_version"), d.deployed_version, true)}
      </div>

      <div class="section">
        <h4 class="section-title">${this._localize("dashboard.drawer_configuration")}</h4>
        ${this._row("file-document-outline", this._localize("dashboard.drawer_config_file"), d.configuration, true)}
        ${this._row("text-short", this._localize("dashboard.drawer_comment"), d.comment)}
      </div>

      ${d.loaded_integrations && d.loaded_integrations.length > 0
        ? html`
            <div class="section">
              <h4 class="section-title">${this._localize("dashboard.drawer_loaded_integrations")}</h4>
              <div class="tags-wrap">
                ${d.loaded_integrations.map(
                  (i) => html`<span class="tag">${i}</span>`,
                )}
              </div>
            </div>
          `
        : nothing}
    `;
  }

  private _row(icon: string, label: string, value: string | null, mono = false) {
    const empty = !value;
    return html`
      <div class="row">
        <div class="icon">
          <wa-icon library="mdi" name=${icon}></wa-icon>
        </div>
        <div class="content">
          <div class="label">${label}</div>
          <div class="value ${mono ? "mono" : ""} ${empty ? "muted" : ""}">
            ${value || "\u2014"}
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-device-drawer-content": ESPHomeDeviceDrawerContent;
  }
}
