import { consume } from "@lit/context";
import { mdiArrowCollapseRight } from "@mdi/js";
import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { LocalizeFunc } from "../common/localize.js";
import { localizeContext } from "../context/index.js";
import { espHomeStyles } from "../styles/shared.js";
import { registerMdiIcons } from "../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/button/button.js";
import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "./esphome-header-actions.js";

registerMdiIcons({
  "arrow-collapse-right": mdiArrowCollapseRight,
});

@customElement("esphome-layout")
export class ESPHomeLayout extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  static styles = [
    espHomeStyles,
    css`
      :host {
        display: block;
        min-height: 100%;
      }

      .app-header {
        display: flex;
        align-items: center;
        gap: var(--wa-space-m);
        padding: 0 var(--wa-space-s);
        background: var(--esphome-primary);
        height: var(--esphome-header-height);
        box-sizing: border-box;
        overflow: hidden;
      }

      .header-logos {
        display: flex;
        align-items: center;
        gap: var(--wa-space-m);
      }

      .ha-btn::part(base) {
        padding: 6px 6px;
        gap: 6px;
      }

      .ha-btn::part(label) {
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .header-separator {
        width: 1px;
        align-self: stretch;
        background: var(--esphome-primary-light);
        flex-shrink: 0;
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
        background: none;
        border: none;
        padding: 0;
        cursor: pointer;
      }

      .header-text h1 {
        margin: 0;
        font-size: var(--wa-font-size-m);
        font-weight: var(--wa-font-weight-bold);
        color: var(--esphome-on-primary);
      }

      .header-text p {
        margin: 0;
        font-size: var(--wa-font-size-xs);
        color: var(--esphome-on-primary);
        opacity: 0.75;
      }

      .header-spacer {
        flex: 1;
      }
    `,
  ];

  private _goHome() {
    window.history.pushState({}, "", "/");
    window.dispatchEvent(new PopStateEvent("popstate"));
  }

  protected render() {
    return html`
      <div class="app-header">
        <div class="header-logos">
          <wa-button class="ha-btn" variant="light" size="small" title=${this._localize("layout.home_assistant")}>
            <wa-icon library="mdi" name="arrow-collapse-right"></wa-icon>
            <img src="/assets/logo/ha.svg" alt="Home Assistant" />
          </wa-button>
          <div class="header-separator"></div>
          <button class="header-logo" @click=${this._goHome}>
            <img src="/assets/logo/esphome.svg" alt="ESPHome" />
          </button>
        </div>
        <div class="header-text">
          <h1>${this._localize("dashboard.title")}</h1>
          <p>${this._localize("dashboard.subtitle")}</p>
        </div>
        <div class="header-spacer"></div>
        <esphome-header-actions></esphome-header-actions>
      </div>
      <slot></slot>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-layout": ESPHomeLayout;
  }
}
