import { consume } from "@lit/context";
import { mdiBugOutline, mdiDotsVertical } from "@mdi/js";
import { html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";

import type { LocalizeFunc } from "../../common/localize.js";
import { headerActionsStyles } from "../../components/esphome-header-actions.styles.js";
import { OverflowMenuElement } from "../../components/overflow-menu-element.js";
import { localizeContext } from "../../context/index.js";
import { dropdownMenuStyles } from "../../styles/dropdown-menu.js";
import { espHomeStyles } from "../../styles/shared.js";
import { registerMdiIcons } from "../../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({
  "bug-outline": mdiBugOutline,
  "dots-vertical": mdiDotsVertical,
});

const REPORT_ISSUE_URL =
  "https://github.com/esphome/device-builder-frontend/issues/new?template=web_bug_report.yml";

/**
 * ESPHome Web's counterpart to the dashboard's header kebab
 * (``esphome-header-actions``). The web shell has no backend, so instead of the
 * feedback dialog it links straight to the web.esphome.io issue form.
 */
@customElement("esphome-web-header-actions")
export class ESPHomeWebHeaderActions extends OverflowMenuElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  static styles = [espHomeStyles, dropdownMenuStyles, headerActionsStyles];

  protected render() {
    const kebabLabel = this._localize("web.header.more_options");
    return html`
      <button
        type="button"
        class="menu-btn menu-kebab"
        @click=${this._toggle}
        title=${kebabLabel}
        aria-label=${kebabLabel}
      >
        <wa-icon library="mdi" name="dots-vertical"></wa-icon>
      </button>
      ${
        this._open
          ? html`
              <div class="backdrop" @click=${this._close}></div>
              <div
                class="menu"
                role="menu"
                style="position:fixed;top:var(--esphome-header-height, 48px);right:var(--wa-space-s);"
              >
                <a
                  class="menu-item menu-item--link"
                  role="menuitem"
                  href=${REPORT_ISSUE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  @click=${this._close}
                  @keydown=${this._onItemKeydown}
                >
                  <wa-icon library="mdi" name="bug-outline"></wa-icon>
                  <span class="menu-item-label"
                    >${this._localize("web.header.report_issue")}</span
                  >
                </a>
              </div>
            `
          : nothing
      }
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-web-header-actions": ESPHomeWebHeaderActions;
  }
}
