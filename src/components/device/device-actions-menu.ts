import { consume } from "@lit/context";
import {
  mdiBroom,
  mdiCheckCircleOutline,
  mdiDotsVertical,
  mdiOpenInNew,
  mdiTextBoxOutline,
} from "@mdi/js";
import { css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { localizeContext } from "../../context/index.js";
import { dropdownMenuStyles } from "../../styles/dropdown-menu.js";
import { espHomeStyles } from "../../styles/shared.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { renderVisitWebUiLink } from "../../util/visit-web-ui-link.js";
import { OverflowMenuElement } from "../overflow-menu-element.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({
  broom: mdiBroom,
  "check-circle-outline": mdiCheckCircleOutline,
  "dots-vertical": mdiDotsVertical,
  "open-in-new": mdiOpenInNew,
  "text-box-outline": mdiTextBoxOutline,
});

/** Editor bottom-bar overflow menu: device-scoped actions (Clean build, Visit web UI, Validate, Logs). */
@customElement("esphome-device-actions-menu")
export class ESPHomeDeviceActionsMenu extends OverflowMenuElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  /** A build is in flight — cleaning its files mid-build would corrupt it. */
  @property({ type: Boolean }) busy = false;

  /** Unsaved edits block validation (Install validates too); disable the row. */
  @property({ type: Boolean, attribute: "validate-disabled" }) validateDisabled = false;

  /** Prebuilt ``buildWebUiUrl`` result; empty hides the Visit-web-UI item
   *  (no ``web_server:`` compiled in, or no host known yet). */
  @property({ attribute: false }) webUiUrl = "";

  static styles = [
    espHomeStyles,
    dropdownMenuStyles,
    css`
      :host {
        position: relative;
        display: inline-flex;
      }
      .menu-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        box-sizing: border-box;
        width: 32px;
        height: 32px;
        padding: 0;
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        border-radius: var(--wa-border-radius-m);
        background: transparent;
        color: var(--wa-color-text-normal);
        cursor: pointer;
        transition:
          background 0.12s,
          border-color 0.12s;
      }
      .menu-btn:hover {
        background: var(--esphome-tint);
      }
      .menu-btn wa-icon {
        font-size: 18px;
      }
      /* Bottom action bar sits at the viewport foot — open upward. */
      .menu {
        position: absolute;
        bottom: calc(100% + var(--wa-space-xs));
        right: 0;
        min-width: 200px;
      }
      .menu-item--disabled {
        opacity: 0.5;
        cursor: default;
      }
      .menu-item--disabled:hover {
        background-color: transparent;
      }
    `,
  ];

  protected render() {
    const menuLabel = this._localize("device.actions_menu");
    return html`
      <button
        type="button"
        class="menu-btn"
        @click=${this._toggle}
        title=${menuLabel}
        aria-label=${menuLabel}
        aria-haspopup="menu"
        aria-expanded=${this._open ? "true" : "false"}
      >
        <wa-icon library="mdi" name="dots-vertical"></wa-icon>
      </button>
      ${
        this._open
          ? html`
              <div class="backdrop" @click=${this._close}></div>
              <!-- Opens upward, so DOM order inverts distance from the
                   trigger: frequent actions (Logs) last / nearest the
                   click, rare ones (Clean build) first / furthest. -->
              <div class="menu" role="menu">
                <div
                  class="menu-item ${this.busy ? "menu-item--disabled" : ""}"
                  role="menuitem"
                  tabindex=${this.busy ? "-1" : "0"}
                  aria-disabled=${this.busy ? "true" : "false"}
                  title=${
                    this.busy
                      ? this._localize("dashboard.action_clean_build_busy")
                      : nothing
                  }
                  @click=${this.busy ? undefined : this._onCleanBuild}
                  @keydown=${this.busy ? undefined : this._onItemKeydown}
                >
                  <wa-icon library="mdi" name="broom"></wa-icon>
                  <span class="menu-item-label"
                    >${this._localize("dashboard.action_clean_build")}</span
                  >
                </div>
                <div class="menu-divider" role="separator"></div>
                ${
                  this.webUiUrl
                    ? renderVisitWebUiLink(this.webUiUrl, this._localize, {
                        className: "menu-item menu-item--link",
                        onClick: this._close,
                        withLabel: true,
                        role: "menuitem",
                      })
                    : nothing
                }
                <div
                  class="menu-item ${this.validateDisabled ? "menu-item--disabled" : ""}"
                  role="menuitem"
                  tabindex=${this.validateDisabled ? "-1" : "0"}
                  aria-disabled=${this.validateDisabled ? "true" : "false"}
                  title=${
                    this.validateDisabled
                      ? this._localize("device.validate_disabled_pending")
                      : nothing
                  }
                  @click=${this.validateDisabled ? undefined : this._onValidate}
                  @keydown=${this.validateDisabled ? undefined : this._onItemKeydown}
                >
                  <wa-icon library="mdi" name="check-circle-outline"></wa-icon>
                  <span class="menu-item-label"
                    >${this._localize("device.validate")}</span
                  >
                </div>
                <div
                  class="menu-item"
                  role="menuitem"
                  tabindex="0"
                  @click=${this._onLogs}
                  @keydown=${this._onItemKeydown}
                >
                  <wa-icon library="mdi" name="text-box-outline"></wa-icon>
                  <span class="menu-item-label"
                    >${this._localize("device.show_logs")}</span
                  >
                </div>
              </div>
            `
          : nothing
      }
    `;
  }

  private _onLogs = () => {
    this._close();
    this._emit("open-logs");
  };

  private _onValidate = () => {
    if (this.validateDisabled) return;
    this._close();
    this._emit("validate");
  };

  private _onCleanBuild = () => {
    if (this.busy) return;
    this._close();
    this._emit("clean-build");
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-device-actions-menu": ESPHomeDeviceActionsMenu;
  }
}
