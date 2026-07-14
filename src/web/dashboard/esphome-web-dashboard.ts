import { consume } from "@lit/context";
import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import type { LocalizeFunc } from "../../common/localize.js";
import { localizeContext } from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import { isWebSerialSupported } from "../../util/web-serial.js";
import { parseDashboardHint } from "../dashboard-hint.js";
import type { WebMode } from "../web-mode.js";
import "./esphome-web-esp-connect-card.js";
import "./esphome-web-pico-connect-card.js";
import "./esphome-web-unsupported-card.js";

/**
 * ESPHome Web landing page: the connect card for the active device family (or
 * the unsupported-browser card) plus the introductory copy explaining what
 * the site is. Backend-free — everything below runs over Web Serial.
 */
@customElement("esphome-web-dashboard")
export class ESPHomeWebDashboard extends LitElement {
  @property() mode: WebMode = "esp";

  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  connectedCallback(): void {
    super.connectedCallback();
    // The legacy ?dashboard_* hint is derived from the URL query, so re-render
    // on back/forward navigation to keep it in sync with the current query.
    window.addEventListener("popstate", this._onPopState);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener("popstate", this._onPopState);
  }

  private _onPopState = (): void => this.requestUpdate();

  private _renderHint() {
    // Legacy ``?dashboard_logs/install/wizard`` deep-link hint (ESP-only). Read
    // fresh each render so it isn't stale after a navigation changed the query.
    const hint = parseDashboardHint();
    // Only ESP has the Logs / Install / Prepare actions the hint points at.
    if (!hint || this.mode !== "esp" || !isWebSerialSupported()) return null;
    return html`<div class="hint" role="note">
      ${this._localize(`web.dashboard_hint.${hint}`)}
    </div>`;
  }

  private _renderConnectCard() {
    if (!isWebSerialSupported()) {
      return html`<esphome-web-unsupported-card></esphome-web-unsupported-card>`;
    }
    return this.mode === "pico"
      ? html`<esphome-web-pico-connect-card></esphome-web-pico-connect-card>`
      : html`<esphome-web-esp-connect-card></esphome-web-esp-connect-card>`;
  }

  protected render() {
    const isPico = this.mode === "pico";
    return html`
      <div class="container">
        ${this._renderHint()} ${this._renderConnectCard()}
        <div class="intro">
          <p><b>${this._localize("web.intro.welcome")}</b></p>
          <p>
            ${
              isPico
                ? this._localize("web.intro.body_pico")
                : this._localize("web.intro.body_esp")
            }
          </p>
          <p>${this._localize("web.intro.privacy")}</p>
          <p>${this._localize("web.intro.lite")}</p>
          <p>
            <a
              href="https://esphome.io/guides/getting_started_hassio.html"
              target="_blank"
              rel="noopener noreferrer"
              >${this._localize("web.intro.get_esphome")}</a
            >
          </p>
        </div>
      </div>
    `;
  }

  static styles = [
    espHomeStyles,
    css`
      .container {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--wa-space-xl);
        width: 90%;
        max-width: 30rem;
        margin: var(--wa-space-2xl) auto;
      }
      .container > * {
        width: 100%;
      }
      .hint {
        box-sizing: border-box;
        padding: var(--wa-space-s) var(--wa-space-m);
        border-radius: var(--wa-border-radius-m);
        background: var(--esphome-tint);
        border: 1px solid var(--esphome-tint-border);
        color: var(--wa-color-text-normal);
        font-size: var(--wa-font-size-s);
      }
      .intro {
        color: var(--wa-color-text-normal);
        line-height: var(--wa-line-height-normal);
      }
      .intro a {
        color: var(--esphome-primary);
        text-decoration: none;
      }
      .intro a:hover {
        text-decoration: underline;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-web-dashboard": ESPHomeWebDashboard;
  }
}
