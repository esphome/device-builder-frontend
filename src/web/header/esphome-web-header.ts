import { consume } from "@lit/context";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import type { LocalizeFunc } from "../../common/localize.js";
import { localizeContext } from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import { isWebSerialSupported } from "../../util/web-serial.js";
import { DEFAULT_WEB_MODE } from "../platforms/registry.js";
import { modeUrl, type WebMode } from "../web-mode.js";

import "./esphome-web-header-actions.js";
import "./esphome-web-mode-picker.js";

/**
 * ESPHome Web top bar. The device-family picker on the right is hidden
 * without Web Serial and in flash-receiver mode.
 */
@customElement("esphome-web-header")
export class ESPHomeWebHeader extends LitElement {
  @property() mode: WebMode = DEFAULT_WEB_MODE;

  /** Hide the mode picker (flash-receiver mode has no device family). */
  @property({ type: Boolean }) minimal = false;

  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

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
            ? html`<esphome-web-mode-picker
                class="mode-picker"
                .mode=${this.mode}
              ></esphome-web-mode-picker>`
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

      .mode-picker {
        flex-shrink: 1;
        min-width: 0;
      }

      /* Compact header below 870px: subtitle drops, logo shrinks. */
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
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-web-header": ESPHomeWebHeader;
  }
}
