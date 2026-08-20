import { consume } from "@lit/context";
import { mdiEye, mdiEyeOff } from "@mdi/js";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { localizeContext } from "../../context/index.js";
import {
  dialogActionButtonStyles,
  dialogActionsRowStyles,
} from "../../styles/dialog-action-buttons.js";
import { dialogChromeStyles } from "../../styles/dialog-chrome.js";
import { espHomeStyles } from "../../styles/shared.js";
import { DialogOpenController } from "../../util/dialog-open-controller.js";
import { fireEvent } from "../../util/fire-event.js";
import { registerMdiIcons } from "../../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "../base-dialog.js";
import "../yaml-diff.js";

registerMdiIcons({
  eye: mdiEye,
  "eye-off": mdiEyeOff,
});

/**
 * Before/after preview of the one-click config migration: the draft
 * against the migrated text, with the nudge's own "Update config"
 * (``request-migrate-config``). The diff is built only while open.
 */
@customElement("esphome-config-migration-preview-dialog")
export class ESPHomeConfigMigrationPreviewDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  /** The configuration (YAML filename) the draft belongs to; names the dialog. */
  @property() configuration = "";

  /** The draft the migration was computed for. */
  @property({ attribute: false }) oldValue = "";

  /** The draft with the migration applied. */
  @property({ attribute: false }) newValue = "";

  @state() private _revealSensitive = false;

  private readonly _dialog = new DialogOpenController(this);

  static styles = [
    espHomeStyles,
    dialogChromeStyles,
    dialogActionButtonStyles,
    dialogActionsRowStyles,
    css`
      esphome-base-dialog {
        --width: min(900px, 95vw);
      }

      .diff-header {
        display: flex;
        justify-content: flex-end;
        margin-bottom: var(--wa-space-2xs);
      }

      .diff {
        display: flex;
        height: min(60vh, 600px);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        border-radius: var(--wa-border-radius-m);
        overflow: hidden;
      }
    `,
  ];

  open() {
    this._revealSensitive = false;
    this._dialog.open = true;
  }

  close() {
    this._dialog.open = false;
  }

  protected render() {
    return html`
      <esphome-base-dialog
        ?open=${this._dialog.open}
        .label=${this._localize("device.config_migration_preview_title", {
          configuration: this.configuration,
        })}
        @request-close=${this._dialog.onRequestClose}
        @after-hide=${this._dialog.onAfterHide}
      >
        ${
          this._dialog.open
            ? html`<div class="diff-header">${this._renderRevealToggle()}</div>
                <div class="diff">
                  <esphome-yaml-diff
                    .oldValue=${this.oldValue}
                    .newValue=${this.newValue}
                    .revealSensitive=${this._revealSensitive}
                  ></esphome-yaml-diff>
                </div>`
            : nothing
        }
        <div class="actions">
          <button class="btn btn--cancel" @click=${this.close}>
            ${this._localize("layout.cancel")}
          </button>
          <button class="btn btn--primary" @click=${this._confirm}>
            ${this._localize("device.config_migration_migrate")}
          </button>
        </div>
      </esphome-base-dialog>
    `;
  }

  private _renderRevealToggle() {
    const label = this._localize(
      this._revealSensitive
        ? "device.yaml_mask_sensitive"
        : "device.yaml_reveal_sensitive"
    );
    return html`<button
      type="button"
      class="ghost-icon-btn"
      aria-pressed=${this._revealSensitive}
      aria-label=${label}
      title=${label}
      @click=${this._toggleRevealSensitive}
    >
      <wa-icon library="mdi" name=${this._revealSensitive ? "eye-off" : "eye"}></wa-icon>
    </button>`;
  }

  private _toggleRevealSensitive() {
    this._revealSensitive = !this._revealSensitive;
  }

  private _confirm() {
    this.close();
    fireEvent(this, "request-migrate-config");
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-config-migration-preview-dialog": ESPHomeConfigMigrationPreviewDialog;
  }
}
