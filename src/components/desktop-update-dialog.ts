import { consume } from "@lit/context";
import { LitElement, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { apiErrorDetails } from "../api/api-error.js";
import type { ESPHomeAPI } from "../api/index.js";
import type { DesktopComponentUpdate, DesktopUpdateCheck } from "../api/types/desktop.js";
import type { LocalizeFunc } from "../common/localize.js";
import { apiContext, localizeContext } from "../context/index.js";
import {
  dialogActionButtonStyles,
  dialogActionsRowStyles,
} from "../styles/dialog-action-buttons.js";
import { dialogChromeStyles } from "../styles/dialog-chrome.js";
import { espHomeStyles } from "../styles/shared.js";

import "./base-dialog.js";

/**
 * "Check for updates" dialog, shown only under an ESPHome Desktop app (0.14.0+)
 * that exposes its update `api` (gated on `desktopUpdateCapableContext`). On
 * open it queries `desktop/check_update` and lists per-component availability;
 * "Update now" triggers `desktop/update` (fire-and-forget) and tells the user
 * the app will restart. The update stops and restarts this backend to install,
 * so the connection drops; the user reopens the dialog to re-check afterward.
 */
@customElement("esphome-desktop-update-dialog")
export class ESPHomeDesktopUpdateDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: apiContext })
  @state()
  private _api!: ESPHomeAPI;

  @state() private _open = false;
  @state() private _loading = false;
  @state() private _check: DesktopUpdateCheck | null = null;
  @state() private _error = "";
  @state() private _updating = false;

  static styles = [
    espHomeStyles,
    dialogChromeStyles,
    dialogActionButtonStyles,
    dialogActionsRowStyles,
    css`
      esphome-base-dialog {
        --width: 420px;
      }
      .component {
        display: flex;
        justify-content: space-between;
        gap: var(--wa-space-m);
        padding: var(--wa-space-s) 0;
      }
      .component + .component {
        border-top: var(--wa-border-width-s) solid var(--wa-color-surface-border);
      }
      .component-name {
        font-weight: var(--wa-font-weight-semibold);
      }
      .component-status {
        color: var(--wa-color-text-quiet);
        font-size: var(--wa-font-size-s);
      }
      .component-status.available {
        color: var(--wa-color-brand-fill-loud);
      }
      .message {
        padding: var(--wa-space-m) 0;
        color: var(--wa-color-text-quiet);
      }
      .message.error {
        color: var(--wa-color-danger-fill-loud);
      }
    `,
  ];

  async open() {
    this._open = true;
    this._updating = false;
    await this._runCheck();
  }

  close() {
    this._open = false;
  }

  private _onAfterHide = (): void => {
    this._open = false;
  };

  private _runCheck = async (): Promise<void> => {
    this._loading = true;
    this._error = "";
    this._check = null;
    try {
      this._check = await this._api.desktopCheckUpdate();
    } catch (err) {
      this._error =
        apiErrorDetails(err) || this._localize("desktop_update_dialog.check_error");
    } finally {
      this._loading = false;
    }
  };

  private _confirm = async (): Promise<void> => {
    this._updating = true;
    this._error = "";
    try {
      const { started } = await this._api.desktopInstallUpdate();
      if (!started) {
        // The updater couldn't spawn; clear the busy state so the user isn't
        // stranded on an un-closable "Updating" dialog (the busy gate blocks
        // every dismiss path).
        this._updating = false;
        this._error = this._localize("desktop_update_dialog.update_error");
      }
    } catch (err) {
      this._updating = false;
      this._error =
        apiErrorDetails(err) || this._localize("desktop_update_dialog.update_error");
    }
  };

  private _componentRow(nameKey: string, component: DesktopComponentUpdate) {
    let status: string;
    let available = false;
    if (component.error) {
      status = this._localize("desktop_update_dialog.check_failed");
    } else if (component.installed === null) {
      status = this._localize("desktop_update_dialog.not_installed");
    } else if (component.available && component.latest) {
      status = `${component.installed} → ${component.latest}`;
      available = true;
    } else {
      status = this._localize("desktop_update_dialog.up_to_date");
    }
    return html`
      <div class="component">
        <span class="component-name">${this._localize(nameKey)}</span>
        <span class="component-status ${available ? "available" : ""}">${status}</span>
      </div>
    `;
  }

  protected render() {
    return html`
      <esphome-base-dialog
        ?open=${this._open}
        ?busy=${this._updating}
        .label=${this._localize("desktop_update_dialog.title")}
        @after-hide=${this._onAfterHide}
      >
        ${this._open ? this._renderBody() : nothing}
      </esphome-base-dialog>
    `;
  }

  private _renderBody() {
    if (this._updating) {
      return html`<div class="message" role="status">
        ${this._localize("desktop_update_dialog.updating")}
      </div>`;
    }
    if (this._loading) {
      return html`<div class="message" role="status">
        ${this._localize("desktop_update_dialog.checking")}
      </div>`;
    }
    if (this._error) {
      return html`
        <div class="message error" role="alert">${this._error}</div>
        <div class="actions">
          <button class="btn btn--cancel" @click=${this.close}>
            ${this._localize("layout.close")}
          </button>
          <button class="btn btn--primary" @click=${this._runCheck}>
            ${this._localize("desktop_update_dialog.retry")}
          </button>
        </div>
      `;
    }
    const check = this._check;
    if (!check) {
      return nothing;
    }
    const anyError =
      check.app.error !== null ||
      check.esphome.error !== null ||
      check.device_builder.error !== null;
    return html`
      ${this._componentRow("desktop_update_dialog.component_app", check.app)}
      ${this._componentRow("desktop_update_dialog.component_esphome", check.esphome)}
      ${this._componentRow(
        "desktop_update_dialog.component_device_builder",
        check.device_builder
      )}
      ${
        // Only claim "everything is up to date" when nothing is available AND
        // no component's check failed (a failed row must not read as up to date).
        !check.any_available && !anyError
          ? html`<div class="message" role="status">
              ${this._localize("desktop_update_dialog.all_up_to_date")}
            </div>`
          : nothing
      }
      <div class="actions">
        <button class="btn btn--cancel" @click=${this.close}>
          ${this._localize("layout.close")}
        </button>
        <button
          class="btn btn--primary"
          ?disabled=${!check.any_available}
          @click=${this._confirm}
        >
          ${this._localize("desktop_update_dialog.update_now")}
        </button>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-desktop-update-dialog": ESPHomeDesktopUpdateDialog;
  }
}
