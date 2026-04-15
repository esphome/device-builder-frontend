import {
  mdiFileDocumentOutline,
  mdiInformationOutline,
  mdiIpNetworkOutline,
  mdiLan,
  mdiMemory,
  mdiTagMultiple,
  mdiTextShort,
  mdiUpload,
} from "@mdi/js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { ConfiguredDevice } from "../../api/types.js";
import { espHomeStyles } from "../../styles/shared.js";
import { registerMdiIcons } from "../../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({
  "file-document-outline": mdiFileDocumentOutline,
  "information-outline": mdiInformationOutline,
  "ip-network-outline": mdiIpNetworkOutline,
  lan: mdiLan,
  memory: mdiMemory,
  "tag-multiple": mdiTagMultiple,
  "text-short": mdiTextShort,
  upload: mdiUpload,
});

@customElement("esphome-device-drawer-content")
export class ESPHomeDeviceDrawerContent extends LitElement {
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
        <h4 class="section-title">Device Information</h4>
        ${this._row("information-outline", "Name", d.friendly_name || d.name)}
        ${this._row("ip-network-outline", "IP Address", d.address, true)}
        ${this._row("memory", "Platform", d.target_platform)}
        ${this._row("lan", "Board", d.board_id, true)}
      </div>

      <div class="section">
        <h4 class="section-title">Version</h4>
        ${this._row("tag-multiple", "Current Version", d.current_version, true)}
        ${this._row("upload", "Deployed Version", d.deployed_version, true)}
      </div>

      <div class="section">
        <h4 class="section-title">Configuration</h4>
        ${this._row("file-document-outline", "Config File", d.configuration, true)}
        ${this._row("text-short", "Comment", d.comment)}
      </div>

      ${d.loaded_integrations && d.loaded_integrations.length > 0
        ? html`
            <div class="section">
              <h4 class="section-title">Loaded Integrations</h4>
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
