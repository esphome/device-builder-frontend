import { consume } from "@lit/context";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";

import type { LocalizeFunc } from "../../common/localize.js";
import { localizeContext } from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import { isWebSerialSupported } from "../../util/web-serial.js";
import { modeUrl, type WebMode } from "../web-mode.js";

import "./esphome-web-header-actions.js";

const MODES: { mode: WebMode; logo: string; labelKey: string }[] = [
  { mode: "esp", logo: "espressif.png", labelKey: "web.header.mode_esp" },
  { mode: "pico", logo: "raspberry.png", labelKey: "web.header.mode_pico" },
  { mode: "nrf", logo: "nordic.svg", labelKey: "web.header.mode_nrf" },
];

/**
 * ESPHome Web top bar. On the right sits a segmented control for choosing
 * the active device family (ESP / Raspberry Pi / nRF52), hidden entirely on
 * browsers without Web Serial and in flash-receiver mode.
 */
@customElement("esphome-web-header")
export class ESPHomeWebHeader extends LitElement {
  @property() mode: WebMode = "esp";

  /** Hide the mode picker (flash-receiver mode has no device family). */
  @property({ type: Boolean }) minimal = false;

  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  private _setMode(mode: WebMode): void {
    this.dispatchEvent(
      new CustomEvent("set-mode", { detail: mode, bubbles: true, composed: true })
    );
  }

  protected render() {
    return html`
      <div class="app-header">
        <a class="header-logo" href=${modeUrl(this.mode)}>
          <img src="/static/logo/esphome.svg" alt="ESPHome" />
        </a>
        <div class="header-text">
          <h1>${this._localize("web.header.title")}</h1>
          <p>${this._localize("web.header.subtitle")}</p>
        </div>
        <div class="header-spacer"></div>
        ${
          !this.minimal && isWebSerialSupported()
            ? html`
                <div
                  class="mode-picker"
                  role="group"
                  aria-label=${this._localize("web.header.mode_picker_label")}
                >
                  ${MODES.map(({ mode, logo, labelKey }) => {
                    const label = this._localize(labelKey);
                    // Below 870px the text label is display:none and the logo
                    // has no alt, so the button needs its own accessible name.
                    return html`
                      <button
                        class=${classMap({ "mode-btn": true, active: this.mode === mode })}
                        aria-pressed=${this.mode === mode}
                        aria-label=${label}
                        @click=${() => this._setMode(mode)}
                      >
                        <img class="mode-logo" src="/static/logo/${logo}" alt="" />
                        <span class="mode-label">${label}</span>
                      </button>
                    `;
                  })}
                </div>
              `
            : nothing
        }
        <esphome-web-header-actions></esphome-web-header-actions>
      </div>
    `;
  }

  static styles = [
    espHomeStyles,
    css`
      :host {
        display: block;
      }

      /* Mirrors esphome-layout's .app-header so the two sites share one
         visual identity; keep in sync with src/components/esphome-layout.ts. */
      .app-header {
        display: flex;
        align-items: center;
        gap: var(--wa-space-m);
        padding: 0 var(--wa-space-l);
        background: var(--esphome-primary);
        height: var(--esphome-header-height);
        box-sizing: border-box;
        overflow: hidden;
      }

      .header-logo {
        width: 44px;
        height: 44px;
        border-radius: var(--wa-border-radius-l);
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        text-decoration: none;
      }

      .header-logo img {
        width: 100%;
        height: 100%;
        object-fit: contain;
      }

      .header-text {
        min-width: 0;
        overflow: hidden;
      }

      .header-text h1 {
        margin: 0;
        font-size: var(--wa-font-size-m);
        font-weight: var(--wa-font-weight-bold);
        color: var(--esphome-on-primary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .header-text p {
        margin: 0;
        font-size: var(--wa-font-size-xs);
        color: var(--esphome-on-primary);
        opacity: 0.75;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .header-spacer {
        flex: 1;
      }

      /* Segmented device-family picker */
      .mode-picker {
        display: inline-flex;
        flex-shrink: 0;
        border-radius: var(--wa-border-radius-m);
        border: 1px solid color-mix(in srgb, var(--esphome-on-primary), transparent 55%);
        overflow: hidden;
      }

      .mode-btn {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 4px 10px;
        background: none;
        border: none;
        border-right: 1px solid
          color-mix(in srgb, var(--esphome-on-primary), transparent 55%);
        color: var(--esphome-on-primary);
        font-size: var(--wa-font-size-xs);
        font-weight: var(--wa-font-weight-semibold);
        font-family: inherit;
        cursor: pointer;
        opacity: 0.6;
        transition:
          background 0.1s,
          opacity 0.1s;
        white-space: nowrap;
      }

      .mode-btn:last-child {
        border-right: none;
      }

      .mode-btn:hover {
        background: color-mix(in srgb, var(--esphome-on-primary), transparent 85%);
        opacity: 1;
      }

      .mode-btn.active {
        background: color-mix(in srgb, var(--esphome-on-primary), transparent 75%);
        opacity: 1;
        cursor: default;
      }

      .mode-logo {
        height: 16px;
        flex-shrink: 0;
      }

      /* Compact header below 870px: subtitle drops, logo shrinks, mode labels hide. */
      @media (max-width: 870px) {
        .app-header {
          gap: var(--wa-space-s);
        }

        .header-text p {
          display: none;
        }

        .header-logo {
          width: 32px;
          height: 32px;
          padding: 3px 0;
          box-sizing: border-box;
        }

        .mode-label {
          display: none;
        }

        .mode-btn {
          padding: 4px 8px;
        }
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-web-header": ESPHomeWebHeader;
  }
}
