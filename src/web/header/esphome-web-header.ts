import { consume } from "@lit/context";
import { mdiSwapHorizontal } from "@mdi/js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import type { LocalizeFunc } from "../../common/localize.js";
import { localizeContext } from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { isWebSerialSupported } from "../../util/web-serial.js";
import { modeUrl, type WebMode } from "../web-mode.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "./esphome-web-header-actions.js";

registerMdiIcons({ "swap-horizontal": mdiSwapHorizontal });

/**
 * ESPHome Web top bar, replicating the main builder's ``.app-header`` chrome
 * (``esphome-layout.ts``): the brand-primary bar, the 44px logo box, and the
 * bold on-primary title + subtitle. On the right sits the ESP ⇄ Raspberry Pi
 * device-family switch (hidden entirely on browsers without Web Serial) and
 * the overflow kebab.
 */
@customElement("esphome-web-header")
export class ESPHomeWebHeader extends LitElement {
  @property() mode: WebMode = "esp";

  /** Hide the ESP ⇄ Pico switch (flash-receiver mode has no device family). */
  @property({ type: Boolean }) minimal = false;

  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  private _onToggle(): void {
    this.dispatchEvent(new CustomEvent("toggle-mode", { bubbles: true, composed: true }));
  }

  protected render() {
    // True when clicking the switch moves the user to Pico mode (i.e. the
    // current mode is ESP). Names the toggle's destination, not the current mode.
    const switchToPico = this.mode === "esp";
    const targetLogo = switchToPico ? "raspberry" : "espressif";
    const targetLabel = switchToPico
      ? this._localize("web.header.switch_to_pico")
      : this._localize("web.header.switch_to_esp");

    return html`
      <div class="app-header">
        <!-- Keep the current mode in the URL so clicking the logo doesn't drop
             the user out of Pico mode. -->
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
                <button
                  class="switch-btn"
                  @click=${this._onToggle}
                  title=${targetLabel}
                  aria-label=${targetLabel}
                >
                  <img class="target-logo" src="/static/logo/${targetLogo}.png" alt="" />
                  <span class="target-label">${targetLabel}</span>
                  <wa-icon library="mdi" name="swap-horizontal"></wa-icon>
                </button>
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

      /* The device-family switch sits on the primary bar, so it uses the
         on-primary ink like the layout's header actions. */
      .switch-btn {
        display: inline-flex;
        align-items: center;
        gap: var(--wa-space-2xs);
        padding: 4px 10px;
        border-radius: var(--wa-border-radius-m);
        border: var(--wa-border-width-s) solid
          color-mix(in srgb, var(--esphome-on-primary), transparent 60%);
        background: none;
        color: var(--esphome-on-primary);
        font-size: var(--wa-font-size-xs);
        font-weight: var(--wa-font-weight-bold);
        font-family: inherit;
        cursor: pointer;
        flex-shrink: 0;
        transition:
          background 0.12s,
          border-color 0.12s;
      }

      .switch-btn:hover {
        background: color-mix(in srgb, var(--esphome-on-primary), transparent 85%);
        border-color: var(--esphome-on-primary);
      }

      .switch-btn wa-icon {
        font-size: 15px;
      }

      .target-logo {
        height: 20px;
      }

      /* Compact header below the layout's 870px breakpoint: subtitle and
         switch label drop, logo shrinks to fit the 40px bar (the height
         itself comes from the --esphome-header-height token). */
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

        .target-label {
          display: none;
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
