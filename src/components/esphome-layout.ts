import { consume } from "@lit/context";
import { mdiArrowLeft } from "@mdi/js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { LocalizeFunc } from "../common/localize.js";
import {
  isHaIngressContext,
  localizeContext,
  serverVersionContext,
  versionContext,
} from "../context/index.js";
import { MOBILE_BREAKPOINT } from "../styles/breakpoints.js";
import { espHomeStyles } from "../styles/shared.js";
import { stripBase, withBase } from "../util/base-path.js";
import { isDeviceBuilderBeta } from "../util/device-builder-beta.js";
import { navigate, runLeaveGuard } from "../util/navigation.js";
import { registerMdiIcons } from "../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/button/button.js";
import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "./esphome-header-actions.js";

registerMdiIcons({
  "arrow-left": mdiArrowLeft,
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

  @state()
  private _path = stripBase(window.location.pathname);

  private _onPopState = () => {
    this._path = stripBase(window.location.pathname);
  };

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("popstate", this._onPopState);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("popstate", this._onPopState);
  }

  private get _isDashboard(): boolean {
    return this._path === "/" || this._path === "";
  }

  private get _showBack(): boolean {
    return !this._isDashboard;
  }

  protected updated() {
    // Reflect the consumed context to a host attribute so the slim-header
    // CSS (`:host([ingress])`) can key off it.
    this.toggleAttribute("ingress", this._isHaIngress);
  }

  static styles = [
    espHomeStyles,
    css`
      :host {
        display: block;
        min-height: 100%;
        /* Single content inset for the header and the page slotted below,
           so the logo / title line up with the toolbar and cards. The
           dashboard page and the device-table inherit it through the slot;
           trims on mobile to match the tighter body gutter. */
        --content-gutter: var(--wa-space-l);
        /* Shared with .header-back padding so the arrow's edge aligns. */
        --header-edge-inset: 6px;
      }
      @media (max-width: ${MOBILE_BREAKPOINT}px) {
        :host {
          --content-gutter: var(--wa-space-s);
        }
      }

      .app-header {
        display: flex;
        align-items: center;
        gap: var(--wa-space-m);
        padding: 0 var(--content-gutter);
        background: var(--esphome-primary);
        height: var(--esphome-header-height);
        box-sizing: border-box;
        overflow: hidden;
      }

      .header-logos {
        display: flex;
        align-items: center;
        /* Smaller than the logo→title gap (--wa-space-m on .app-header)
           because the back button carries ~8px of its own padding on
           the logo side; this makes the arrow sit the same visual
           distance from the logo as the title does on the other side. */
        gap: var(--wa-space-xs);
      }

      .header-back {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: none;
        background: none;
        color: var(--esphome-on-primary);
        padding: var(--header-edge-inset);
        /* Pull only the arrow to the bar edge; routes without an
           arrow keep the header's content-gutter inset. */
        margin-inline-start: calc(var(--header-edge-inset) - var(--content-gutter));
        border-radius: var(--wa-border-radius-m);
        opacity: 0.85;
        cursor: pointer;
        flex-shrink: 0;
        transition:
          opacity 0.12s,
          background 0.12s;
      }

      .header-back:hover {
        opacity: 1;
        background: color-mix(in srgb, var(--esphome-on-primary), transparent 85%);
      }

      .header-back wa-icon {
        font-size: 20px;
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

      /* The title span is a flex item and needs its own min-width:0
         + overflow handling for text-overflow:ellipsis to apply —
         flex items default to min-width:auto, which keeps them at
         intrinsic width and pushes later siblings (the
         .preview-badge) past the h1's overflow:hidden. Without this
         the badge clipped to just "P|" on phone-width viewports. */
      .header-title-text {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
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

      /* Compact header on narrow viewports. 870px is HA's
         sidebar-collapse breakpoint, so this fires exactly when HA
         shows its own 40px top bar; we apply it everywhere (HA or not)
         so the standalone phone layout is compact too. The 40px height
         comes from the --esphome-header-height token (espHomeStyles).
         Shrink the logo to fit the shorter bar and drop the subtitle. */
      @media (max-width: 870px) {
        .header-text p {
          display: none;
        }

        /* Drop the spacer and let the title grow into the freed width
           so "ESPHome Device Builder" + PREVIEW fit without truncating. */
        .header-spacer {
          display: none;
        }

        .header-text {
          flex: 1;
        }

        .app-header {
          gap: var(--wa-space-s);
        }

        /* Pull the back arrow and logo close together — the desktop
           --wa-space-m gap reads as a big void next to the small logo
           in the 40px bar. */
        .header-logos {
          gap: var(--wa-space-2xs);
        }

        /* Shrink the logo and give it a 3px top/bottom inset so it
           doesn't crowd the 40px bar's edges. box-sizing keeps the
           padding inside the 32px box; the img fills what's left. */
        .header-logo {
          width: 32px;
          height: 32px;
          padding: 3px 0;
          box-sizing: border-box;
        }

        .header-logo img {
          width: 100%;
          height: 100%;
          object-fit: contain;
        }

        /* Embedded in HA, its narrow bar already shows the title, so
           hide our (duplicated) title text. The smaller logo and the
           actions menu stay. */
        :host([ingress]) .header-text {
          display: none;
        }

        /* Title hidden, so bring the spacer back to pin the menu right. */
        :host([ingress]) .header-spacer {
          display: block;
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

  private async _goHome() {
    // Prefer popping the history stack so the previous URL — and
    // therefore the dashboard's filter / search state encoded in
    // its query string — is restored verbatim. ``history.state`` is
    // set to ``{}`` by our own ``navigate()`` helper on every
    // pushState; ``null`` means we landed on this route via a fresh
    // page load (deep link / refresh) so there's nothing useful to
    // pop and we fall back to ``navigate("/")`` to stay inside the
    // SPA instead of exiting to the previous site.
    if (window.history.state !== null && typeof window.history.state === "object") {
      // history.back() fires a raw popstate the router commits (unmounting the
      // page) before the device editor's popstate guard can veto it, so honour
      // the leave guard here — same gate navigate() applies. navigate("/") runs
      // the guard itself, so the fallback isn't double-prompted.
      if (!(await runLeaveGuard())) return;
      window.history.back();
      return;
    }
    navigate("/");
  }

  protected render() {
    return html`
      <div class="app-header">
        <div class="header-logos">
          ${this._showBack
            ? html`
                <button
                  class="header-back"
                  @click=${this._goHome}
                  title=${this._localize("layout.back")}
                  aria-label=${this._localize("layout.back")}
                >
                  <wa-icon library="mdi" name="arrow-left"></wa-icon>
                </button>
              `
            : nothing}
          <button class="header-logo" @click=${this._goHome}>
            <img src=${withBase("/assets/logo/esphome.svg")} alt="ESPHome" />
          </button>
        </div>
        <div class="header-text">
          <h1>
            <span class="header-title-text">${this._localize("dashboard.title")}</span>
            ${isDeviceBuilderBeta(this._serverVersion)
              ? html`<span class="preview-badge"
                  >${this._localize("layout.preview_badge")}</span
                >`
              : nothing}
          </h1>
          <p>${this._localize("dashboard.subtitle")}</p>
        </div>
        <div class="header-spacer"></div>
        <esphome-header-actions
          ?dashboard-route=${this._isDashboard}
        ></esphome-header-actions>
      </div>
      <slot></slot>
      <div class="app-footer">
        ${this._serverVersion
          ? html`<span>ESPHome Device Builder v${this._serverVersion}</span>`
          : nothing}
        ${this._esphomeVersion
          ? html`<span>ESPHome ${this._esphomeVersion}</span>`
          : nothing}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-layout": ESPHomeLayout;
  }
}
