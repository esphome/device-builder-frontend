import { consume } from "@lit/context";
import { mdiArrowCollapseRight } from "@mdi/js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { LocalizeFunc } from "../common/localize.js";
import { isHaIngressContext, localizeContext, serverVersionContext, versionContext } from "../context/index.js";
import { espHomeStyles } from "../styles/shared.js";
import { withBase } from "../util/base-path.js";
import { navigate } from "../util/navigation.js";
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

  @consume({ context: isHaIngressContext, subscribe: true })
  @state()
  private _isHaIngress = false;

  @consume({ context: versionContext, subscribe: true })
  @state()
  private _esphomeVersion = "";

  @consume({ context: serverVersionContext, subscribe: true })
  @state()
  private _serverVersion = "";

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
        display: flex;
        align-items: center;
        gap: var(--wa-space-xs);
      }

      .preview-badge {
        font-size: 9px;
        font-weight: var(--wa-font-weight-bold);
        letter-spacing: 0.06em;
        text-transform: uppercase;
        padding: 2px 6px;
        border-radius: var(--wa-border-radius-s);
        background: color-mix(in srgb, var(--esphome-on-primary), transparent 80%);
        color: var(--esphome-on-primary);
        border: 1px solid color-mix(in srgb, var(--esphome-on-primary), transparent 60%);
        line-height: 1;
        flex-shrink: 0;
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

      /* Mobile: drop the subtitle so the title isn't squashed against
         the top of the viewport, and keep header height compact. */
      @media (max-width: 700px) {
        .header-text p {
          display: none;
        }
      }

      .app-footer {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        height: var(--esphome-footer-height);
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--wa-space-m);
        font-size: 10px;
        /* Opaque background so scrolled content can't bleed through;
           text is dimmed via color-mix instead of an opacity on the
           host (which would make the background translucent too). */
        background: var(--wa-color-surface-default);
        color: color-mix(in srgb, var(--wa-color-text-quiet), transparent 30%);
        user-select: text;
      }
    `,
  ];

  private _goHome() {
    // Prefer popping the history stack so the previous URL — and
    // therefore the dashboard's filter / search state encoded in
    // its query string — is restored verbatim. ``history.state`` is
    // set to ``{}`` by our own ``navigate()`` helper on every
    // pushState; ``null`` means we landed on this route via a fresh
    // page load (deep link / refresh) so there's nothing useful to
    // pop and we fall back to ``navigate("/")`` to stay inside the
    // SPA instead of exiting to the previous site.
    if (
      window.history.state !== null &&
      typeof window.history.state === "object"
    ) {
      window.history.back();
      return;
    }
    navigate("/");
  }

  protected render() {
    return html`
      <div class="app-header">
        <div class="header-logos">
          ${this._isHaIngress
            ? html`
                <wa-button
                  class="ha-btn"
                  variant="light"
                  size="small"
                  title=${this._localize("layout.home_assistant")}
                >
                  <wa-icon library="mdi" name="arrow-collapse-right"></wa-icon>
                  <img src=${withBase("/assets/logo/ha.svg")} alt="Home Assistant" />
                </wa-button>
                <div class="header-separator"></div>
              `
            : nothing}
          <button class="header-logo" @click=${this._goHome}>
            <img src=${withBase("/assets/logo/esphome.svg")} alt="ESPHome" />
          </button>
        </div>
        <div class="header-text">
          <h1>
            <span>${this._localize("dashboard.title")}</span>
            <span class="preview-badge">${this._localize("layout.preview_badge")}</span>
          </h1>
          <p>${this._localize("dashboard.subtitle")}</p>
        </div>
        <div class="header-spacer"></div>
        <esphome-header-actions></esphome-header-actions>
      </div>
      <slot></slot>
      <div class="app-footer">
        ${this._serverVersion ? html`<span>ESPHome Device Builder v${this._serverVersion}</span>` : nothing}
        ${this._esphomeVersion ? html`<span>ESPHome ${this._esphomeVersion}</span>` : nothing}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-layout": ESPHomeLayout;
  }
}
