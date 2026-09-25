import { consume } from "@lit/context";
import {
  mdiBroom,
  mdiCheckCircleOutline,
  mdiDotsVertical,
  mdiMemory,
  mdiOpenInNew,
  mdiTextBoxOutline,
} from "@mdi/js";
import { css, html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { expertModeContext, localizeContext } from "../../context/index.js";
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
  memory: mdiMemory,
  "open-in-new": mdiOpenInNew,
  "text-box-outline": mdiTextBoxOutline,
});

/** Editor bottom-bar overflow menu: device-scoped actions (Analyze memory in
 *  Expert Mode, Clean build, Visit web UI, Validate, Logs). */
@customElement("esphome-device-actions-menu")
export class ESPHomeDeviceActionsMenu extends OverflowMenuElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  /** Expert Mode unlocks Analyze memory, which lives only in this menu. */
  @consume({ context: expertModeContext, subscribe: true })
  @state()
  private _expertMode = false;

  /** A build is in flight — cleaning its files mid-build would corrupt it. */
  @property({ type: Boolean }) busy = false;

  /** Unsaved edits block Validate and Analyze memory (both read the saved
   *  YAML, so a draft would silently be left out); disable those rows. */
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
                   click, rare ones (Analyze memory, Clean build) first /
                   furthest. -->
              <div class="menu" role="menu">
                ${
                  this._expertMode
                    ? this._renderItem({
                        icon: "memory",
                        labelKey: "dashboard.action_analyze_memory",
                        onSelect: this._onAnalyzeMemory,
                        disabledTitle: this.busy
                          ? this._localize("dashboard.action_analyze_memory_busy")
                          : this.validateDisabled
                            ? this._localize("device.analyze_memory_disabled_pending")
                            : null,
                      })
                    : nothing
                }
                ${this._renderItem({
                  icon: "broom",
                  labelKey: "dashboard.action_clean_build",
                  onSelect: this._onCleanBuild,
                  disabledTitle: this.busy
                    ? this._localize("dashboard.action_clean_build_busy")
                    : null,
                })}
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
                ${this._renderItem({
                  icon: "check-circle-outline",
                  labelKey: "device.validate",
                  onSelect: this._onValidate,
                  disabledTitle: this.validateDisabled
                    ? this._localize("device.validate_disabled_pending")
                    : null,
                })}
                ${this._renderItem({
                  icon: "text-box-outline",
                  labelKey: "device.show_logs",
                  onSelect: this._onLogs,
                  disabledTitle: null,
                })}
              </div>
            `
          : nothing
      }
    `;
  }

  /** One menu row; a non-null ``disabledTitle`` disables it and explains why. */
  private _renderItem(item: {
    icon: string;
    labelKey: string;
    onSelect: () => void;
    disabledTitle: string | null;
  }): TemplateResult {
    const disabled = item.disabledTitle !== null;
    return html`
      <div
        class="menu-item ${disabled ? "menu-item--disabled" : ""}"
        role="menuitem"
        tabindex=${disabled ? "-1" : "0"}
        aria-disabled=${disabled ? "true" : "false"}
        title=${item.disabledTitle ?? nothing}
        @click=${disabled ? undefined : item.onSelect}
        @keydown=${disabled ? undefined : this._onItemKeydown}
      >
        <wa-icon library="mdi" name=${item.icon}></wa-icon>
        <span class="menu-item-label">${this._localize(item.labelKey)}</span>
      </div>
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

  private _onAnalyzeMemory = () => {
    if (this.busy || this.validateDisabled) return;
    this._close();
    this._emit("analyze-memory");
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-device-actions-menu": ESPHomeDeviceActionsMenu;
  }
}
