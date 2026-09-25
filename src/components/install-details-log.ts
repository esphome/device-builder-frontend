import { consume } from "@lit/context";
import { mdiChevronDown, mdiChevronUp, mdiDownload } from "@mdi/js";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import type { LocalizeFunc } from "../common/localize.js";
import { darkModeContext, localizeContext } from "../context/index.js";
import { espHomeStyles } from "../styles/shared.js";
import { initialDarkMode } from "../util/dark-mode.js";
import { downloadAnsiText } from "../util/download-text.js";
import { registerMdiIcons } from "../util/register-icons.js";
import "./ansi-log.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({
  "chevron-down": mdiChevronDown,
  "chevron-up": mdiChevronUp,
  download: mdiDownload,
});

/**
 * The collapsible details log under an install card: a flash engine's step
 * lines behind a Show details toggle, with a download. The host may drive
 * ``expanded`` (it is mirrored back through ``expanded-changed``) and may
 * take over the download by cancelling ``download-log``; otherwise the
 * lines are saved as ``downloadName``. ``--install-log-height`` sizes the
 * open log.
 */
@customElement("esphome-install-details-log")
export class ESPHomeInstallDetailsLog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: darkModeContext, subscribe: true })
  @state()
  private _darkMode = initialDarkMode();

  @property({ attribute: false }) lines: readonly string[] = [];

  /** The device's ``target_platform`` for the log's crash decoding; "" when unknown. */
  @property({ attribute: false }) targetPlatform = "";

  @property({ type: Boolean }) expanded = false;

  @property({ attribute: "download-name" }) downloadName = "install.txt";

  private _toggle = () => {
    this.expanded = !this.expanded;
    this.dispatchEvent(new CustomEvent("expanded-changed", { detail: this.expanded }));
  };

  private _download = () => {
    const event = new Event("download-log", { cancelable: true });
    if (this.dispatchEvent(event)) downloadAnsiText(this.lines, this.downloadName);
  };

  protected render() {
    return html`
      <div class="logs-header">
        <button
          class="logs-toggle"
          aria-expanded=${this.expanded ? "true" : "false"}
          aria-controls=${this.expanded ? "log" : nothing}
          @click=${this._toggle}
        >
          <wa-icon
            library="mdi"
            name=${this.expanded ? "chevron-up" : "chevron-down"}
          ></wa-icon>
          ${this._localize(this.expanded ? "firmware.hide_details" : "firmware.show_details")}
        </button>
        <button class="logs-toggle" @click=${this._download}>
          <wa-icon library="mdi" name="download"></wa-icon>
          ${this._localize("dashboard.logs_download")}
        </button>
      </div>
      ${
        this.expanded
          ? html`<div class="logs-container" id="log">
              <esphome-ansi-log
                .lines=${this.lines}
                .targetPlatform=${this.targetPlatform}
                ?light=${!this._darkMode}
              ></esphome-ansi-log>
            </div>`
          : nothing
      }
    `;
  }

  static styles = [
    espHomeStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        min-height: 0;
      }
      .logs-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .logs-toggle {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 0;
        margin-top: var(--wa-space-m);
        background: none;
        border: none;
        font-family: inherit;
        font-size: var(--wa-font-size-xs);
        color: var(--wa-color-text-quiet);
        cursor: pointer;
      }
      .logs-toggle:hover {
        color: var(--wa-color-text-normal);
      }
      .logs-toggle wa-icon {
        font-size: 16px;
      }
      .logs-container {
        flex: 1 1 auto;
        min-height: 0;
        margin-top: var(--wa-space-s);
        border: 1px solid var(--term-border);
        border-radius: var(--wa-border-radius-m);
        overflow: hidden;
      }
      esphome-ansi-log {
        --log-height: var(--install-log-height, 50vh);
      }
      esphome-ansi-log::part(container) {
        border-radius: 0;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-install-details-log": ESPHomeInstallDetailsLog;
  }
}
