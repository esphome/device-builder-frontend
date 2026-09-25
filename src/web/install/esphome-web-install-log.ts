import { consume } from "@lit/context";
import { mdiChevronDown, mdiChevronUp, mdiDownload } from "@mdi/js";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import type { LocalizeFunc } from "../../common/localize.js";
import "../../components/ansi-log.js";
import { darkModeContext, localizeContext } from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import { initialDarkMode } from "../../util/dark-mode.js";
import { downloadAnsiText } from "../../util/download-text.js";
import { registerMdiIcons } from "../../util/register-icons.js";

registerMdiIcons({
  "chevron-down": mdiChevronDown,
  "chevron-up": mdiChevronUp,
  download: mdiDownload,
});

/**
 * The collapsible details log under an install card: the flash engine's
 * step lines, with a download. Renders nothing until a line arrives.
 */
@customElement("esphome-web-install-log")
export class ESPHomeWebInstallLog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: darkModeContext, subscribe: true })
  @state()
  private _darkMode = initialDarkMode();

  @property({ attribute: false }) lines: readonly string[] = [];

  @state() private _expanded = false;

  private _toggle = () => {
    this._expanded = !this._expanded;
  };

  private _download = () => {
    downloadAnsiText(this.lines, "esphome-web-install.txt");
  };

  protected render() {
    if (this.lines.length === 0) return nothing;
    return html`
      <div class="logs-header">
        <button class="logs-toggle" @click=${this._toggle}>
          <wa-icon
            library="mdi"
            name=${this._expanded ? "chevron-up" : "chevron-down"}
          ></wa-icon>
          ${this._localize(this._expanded ? "firmware.hide_details" : "firmware.show_details")}
        </button>
        <button class="logs-toggle" @click=${this._download}>
          <wa-icon library="mdi" name="download"></wa-icon>
          ${this._localize("dashboard.logs_download")}
        </button>
      </div>
      ${
        this._expanded
          ? html`<div class="logs-container">
              <esphome-ansi-log
                .lines=${this.lines}
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
        display: block;
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
        margin-top: var(--wa-space-s);
        border: 1px solid var(--term-border);
        border-radius: var(--wa-border-radius-m);
        overflow: hidden;
      }
      esphome-ansi-log {
        --log-height: 40vh;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-web-install-log": ESPHomeWebInstallLog;
  }
}
