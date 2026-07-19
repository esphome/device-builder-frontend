import { consume } from "@lit/context";
import {
  mdiArchiveOutline,
  mdiBroom,
  mdiCheckboxMultipleBlankOutline,
  mdiCheckDecagram,
  mdiClockRemoveOutline,
  mdiContentDuplicate,
  mdiDelete,
  mdiDownload,
  mdiFileDownloadOutline,
  mdiFormTextbox,
  mdiKeyVariant,
  mdiOpenInNew,
  mdiPencil,
  mdiRenameOutline,
  mdiTextBoxOutline,
  mdiUpload,
} from "@mdi/js";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { ConfiguredDevice } from "../../api/types/devices.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { localizeContext } from "../../context/index.js";
import { dropdownMenuStyles } from "../../styles/dropdown-menu.js";
import { espHomeStyles } from "../../styles/shared.js";
import { EscapeController } from "../../util/escape-controller.js";
import { fireEvent } from "../../util/fire-event.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { busyActionLabel } from "../../util/update-tooltip.js";
import { renderVisitWebUiLink } from "../../util/visit-web-ui-link.js";
import { buildWebUiUrl } from "../../util/web-ui-url.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({
  "archive-outline": mdiArchiveOutline,
  broom: mdiBroom,
  "checkbox-multiple-blank-outline": mdiCheckboxMultipleBlankOutline,
  "check-decagram": mdiCheckDecagram,
  "clock-remove-outline": mdiClockRemoveOutline,
  "text-box-outline": mdiTextBoxOutline,
  "content-duplicate": mdiContentDuplicate,
  delete: mdiDelete,
  download: mdiDownload,
  "file-download-outline": mdiFileDownloadOutline,
  "form-textbox": mdiFormTextbox,
  "key-variant": mdiKeyVariant,
  "open-in-new": mdiOpenInNew,
  pencil: mdiPencil,
  "rename-outline": mdiRenameOutline,
  upload: mdiUpload,
});

interface MenuPosition {
  x: number;
  y: number;
}

@customElement("esphome-table-row-menu")
export class ESPHomeTableRowMenu extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @property({ attribute: false })
  device: ConfiguredDevice | null = null;

  @property({ type: Boolean })
  busy = false;

  @property({ attribute: false })
  position: MenuPosition | null = null;

  @property({ type: Boolean, attribute: "anchor-right" })
  anchorRight = false;

  /** When true, the menu is being shown for a card view where every
   *  inline action button is always rendered. The duplicate menu items
   *  (Logs, Visit Web UI) are hidden via CSS so the kebab only carries
   *  what isn't already on the card. The host attribute drives the CSS
   *  selector — keep it in sync.
   *
   *  ``Install`` is intentionally NOT deduped: it always shows in the
   *  kebab (whether the inline button is "Install", "Update", or
   *  absent) and opens the install-method dialog where the user picks
   *  OTA / serial / web-flasher / custom-address. The inline buttons
   *  are convenience shortcuts; the kebab entry is the consistent
   *  entry point that doesn't change shape with device state. */
  @property({ type: Boolean, attribute: "card-mode", reflect: true })
  cardMode = false;

  @query(".menu")
  private _menuEl!: HTMLDivElement;

  static styles = [
    espHomeStyles,
    dropdownMenuStyles,
    css`
      :host {
        display: block;
      }

      /* .backdrop / .menu chrome / @keyframes menu-in / .menu-item
         come from the shared dropdownMenuStyles fragment; only this
         menu's width and viewport-fit rules are local. */
      .menu {
        min-width: 170px;
        /* This menu has many items; on short / mobile viewports it would
           otherwise run off the bottom of the screen. Cap it to the
           viewport (8px gutter each side, matching the reposition pad)
           and scroll internally so it always fits. vh fallback first,
           then dvh for browsers that track the dynamic viewport. */
        max-height: calc(100vh - 16px);
        max-height: calc(100dvh - 16px);
        overflow-y: auto;
      }

      .menu-item wa-icon {
        font-size: 16px;
        color: var(--wa-color-text-quiet);
      }

      .menu-item:hover wa-icon {
        color: var(--esphome-primary);
      }

      .menu-item--disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }

      .menu-item--danger {
        color: var(--esphome-error);
      }

      .menu-item--danger:hover {
        background: color-mix(in srgb, var(--esphome-error), transparent 92%);
      }

      .menu-item--danger wa-icon,
      .menu-item--danger:hover wa-icon {
        color: var(--esphome-error);
      }

      /* Dedupe with the inline action buttons. The card always shows
         every inline action when applicable, so card-mode hides the
         duplicate kebab entries unconditionally. The table only shows
         the inline buttons above each priority breakpoint, so for the
         table the kebab entries hide only above those same widths.
         Class names match the inline cell-action-btn modifiers so the
         pairing is obvious at a glance; breakpoints are off-by-one
         from the inline rules so the transition pixel never has both
         copies hidden:
           menu-item--logs                              inline > 920px
           menu-item--visit-web                         inline > 1024px

         The kebab Install entry is intentionally NOT deduped — it
         always shows as the consistent "open the install-method
         picker" entry point regardless of whether the inline button
         is also currently rendering Install / Update. */
      :host([card-mode]) .menu-item--logs,
      :host([card-mode]) .menu-item--visit-web {
        display: none;
      }
      @media (min-width: 921px) {
        :host(:not([card-mode])) .menu-item--logs {
          display: none;
        }
      }
      @media (min-width: 1025px) {
        :host(:not([card-mode])) .menu-item--visit-web {
          display: none;
        }
      }
    `,
  ];

  protected render() {
    if (!this.device || !this.position) return nothing;

    return html`
      <div
        class="backdrop"
        @click=${this._close}
        @contextmenu=${this._preventAndClose}
      ></div>
      <div class="menu" style=${this._initialStyle()}>
        <div class="menu-item" @click=${() => this._emit("validate-device")}>
          <wa-icon library="mdi" name="check-decagram"></wa-icon>
          ${this._localize("dashboard.action_validate")}
        </div>
        <div
          class="menu-item menu-item--install"
          @click=${() => this._emit(this.busy ? "show-progress" : "install-device")}
        >
          <wa-icon library="mdi" name="upload"></wa-icon>
          ${busyActionLabel(this._localize, this.busy, "dashboard.action_install")}
        </div>
        ${
          this.device?.runtime_state.queued_update
            ? html`<div
                class="menu-item ${this.busy ? "menu-item--disabled" : ""}"
                @click=${this.busy ? undefined : () => this._emit("clear-queued-update")}
              >
                <wa-icon library="mdi" name="clock-remove-outline"></wa-icon>
                ${this._localize("dashboard.action_clear_queued")}
              </div>`
            : nothing
        }
        <div class="menu-item menu-item--logs" @click=${() => this._emit("open-logs")}>
          <wa-icon library="mdi" name="text-box-outline"></wa-icon>
          ${this._localize("dashboard.drawer_logs")}
        </div>
        ${this._renderVisitWebUi()}
        <div class="menu-divider"></div>
        ${
          this.device?.api_encrypted
            ? html`<div class="menu-item" @click=${() => this._emit("show-api-key")}>
                <wa-icon library="mdi" name="key-variant"></wa-icon>
                ${this._localize("dashboard.action_show_api_key")}
              </div>`
            : nothing
        }
        <div class="menu-item" @click=${() => this._emit("download-yaml")}>
          <wa-icon library="mdi" name="download"></wa-icon>
          ${this._localize("dashboard.action_download_yaml")}
        </div>
        <div
          class="menu-item ${this.busy ? "menu-item--disabled" : ""}"
          @click=${this.busy ? undefined : () => this._emit("edit-friendly-name")}
        >
          <wa-icon library="mdi" name="form-textbox"></wa-icon>
          ${this._localize("dashboard.action_edit_friendly_name")}
        </div>
        <div
          class="menu-item ${this.busy ? "menu-item--disabled" : ""}"
          @click=${this.busy ? undefined : () => this._emit("rename-device")}
        >
          <wa-icon library="mdi" name="rename-outline"></wa-icon>
          ${this._localize("dashboard.action_rename")}
        </div>
        <div
          class="menu-item ${this.busy ? "menu-item--disabled" : ""}"
          @click=${this.busy ? undefined : () => this._emit("clone-device")}
        >
          <wa-icon library="mdi" name="content-duplicate"></wa-icon>
          ${this._localize("dashboard.action_clone")}
        </div>
        <div
          class="menu-item ${this.busy ? "menu-item--disabled" : ""}"
          @click=${this.busy ? undefined : () => this._emit("clean-build")}
        >
          <wa-icon library="mdi" name="broom"></wa-icon>
          ${this._localize("dashboard.action_clean_build")}
        </div>
        <div class="menu-item" @click=${() => this._emit("download")}>
          <wa-icon library="mdi" name="file-download-outline"></wa-icon>
          ${this._localize("dashboard.action_download")}
        </div>
        <div class="menu-divider"></div>
        <div class="menu-item" @click=${() => this._emit("enter-select")}>
          <wa-icon library="mdi" name="checkbox-multiple-blank-outline"></wa-icon>
          ${this._localize("dashboard.context_select")}
        </div>
        <div class="menu-divider"></div>
        <div
          class="menu-item ${this.busy ? "menu-item--disabled" : ""}"
          @click=${this.busy ? undefined : () => this._emit("archive-device")}
        >
          <wa-icon library="mdi" name="archive-outline"></wa-icon>
          ${this._localize("dashboard.action_archive")}
        </div>
        <div
          class="menu-item menu-item--danger ${this.busy ? "menu-item--disabled" : ""}"
          @click=${this.busy ? undefined : () => this._emit("delete-device")}
        >
          <wa-icon library="mdi" name="delete"></wa-icon>
          ${this._localize("dashboard.delete")}
        </div>
      </div>
    `;
  }

  private _escape = new EscapeController(this, (e) => {
    e.preventDefault();
    this._close();
  });

  protected willUpdate(changed: Map<string, unknown>) {
    if (changed.has("device") || changed.has("position")) {
      this._escape.set(this.device != null && this.position != null);
    }
  }

  protected updated() {
    if (!this._menuEl || !this.position) return;

    const rect = this._menuEl.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pad = 8;

    let x = this.position.x;
    let y = this.position.y;
    let useRight = this.anchorRight;

    // Flip horizontally if overflowing right
    if (!useRight && x + rect.width > vw - pad) {
      useRight = true;
    }

    let style: string;
    if (useRight) {
      const right = Math.max(pad, Math.min(vw - x, vw - rect.width - pad));
      style = `right:${right}px;`;
    } else {
      const left = Math.max(pad, Math.min(x, vw - rect.width - pad));
      style = `left:${left}px;`;
    }

    // Flip vertically if overflowing bottom
    if (y + rect.height > vh - pad) {
      y = Math.max(pad, y - rect.height);
    }

    style += `top:${y}px`;
    this._menuEl.style.cssText = style;
  }

  private _initialStyle(): string {
    if (!this.position) return "";
    if (this.anchorRight) {
      return `right:${window.innerWidth - this.position.x}px;top:${this.position.y}px`;
    }
    return `left:${this.position.x}px;top:${this.position.y}px`;
  }

  private _close() {
    this.device = null;
    this.position = null;
    fireEvent(this, "menu-close");
  }

  private _preventAndClose(e: Event) {
    e.preventDefault();
    this._close();
  }

  private _emit(name: string) {
    fireEvent(this, name, this.device);
    this._close();
  }

  private _renderVisitWebUi() {
    // Render only when we actually have somewhere to send the user.
    // ``buildWebUiUrl`` is the single source of truth for the
    // host/port/protocol logic; it returns "" when the YAML didn't
    // expose web_server or we don't have a host yet.
    if (this.device == null) return nothing;
    const url = buildWebUiUrl(this.device);
    if (!url) return nothing;
    return renderVisitWebUiLink(url, this._localize, {
      className: "menu-item menu-item--link menu-item--visit-web",
      onClick: this._close,
      withLabel: true,
    });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-table-row-menu": ESPHomeTableRowMenu;
  }
}
