import { consume } from "@lit/context";
import { mdiContentCopy, mdiEye, mdiEyeOff } from "@mdi/js";
import { css, html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { LocalizeFunc } from "../common/localize.js";
import { localizeContext } from "../context/index.js";
import { dialogChromeStyles } from "../styles/dialog-chrome.js";
import { espHomeStyles } from "../styles/shared.js";
import { copyToClipboard } from "../util/copy-to-clipboard.js";
import { DialogOpenController } from "../util/dialog-open-controller.js";
import { notifySuccess } from "../util/notify.js";
import { registerMdiIcons } from "../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "./base-dialog.js";

registerMdiIcons({
  "content-copy": mdiContentCopy,
  eye: mdiEye,
  "eye-off": mdiEyeOff,
});

@customElement("esphome-encryption-key-dialog")
export class ESPHomeEncryptionKeyDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @state()
  private _encryptionKey = "";

  @state()
  private _visible = false;

  private readonly _dialog = new DialogOpenController(this);

  static styles = [
    espHomeStyles,
    // Neutral header + title + footer (shared) — dialog-chrome.ts.
    dialogChromeStyles,
    css`
      esphome-base-dialog {
        --width: 480px;
      }

      esphome-base-dialog::part(body) {
        padding: 0 var(--wa-space-l);
      }

      .content {
        padding-bottom: var(--wa-space-l);
      }

      .key-wrap {
        display: flex;
        align-items: center;
        gap: var(--wa-space-s);
        padding: 10px 14px;
        background: var(--wa-color-surface-lowered);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        border-radius: var(--wa-border-radius-m);
      }

      .key-value {
        flex: 1;
        font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
        font-size: var(--wa-font-size-xs);
        color: var(--wa-color-text-normal);
        word-break: break-all;
        user-select: all;
      }

      .key-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 30px;
        height: 30px;
        border: none;
        border-radius: var(--wa-border-radius-m);
        background: transparent;
        color: var(--wa-color-text-quiet);
        cursor: pointer;
        padding: 0;
        flex-shrink: 0;
        transition:
          background 0.12s,
          color 0.12s;
      }

      .key-btn:hover {
        background: var(--wa-color-surface-border);
        color: var(--wa-color-text-normal);
      }

      .key-btn wa-icon {
        font-size: 16px;
      }

      .no-key {
        font-size: var(--wa-font-size-s);
        color: var(--wa-color-text-quiet);
        line-height: 1.5;
      }
    `,
  ];

  open(key: string) {
    this._encryptionKey = key;
    this._visible = false;
    this._dialog.open = true;
  }

  protected render() {
    return html`
      <esphome-base-dialog
        ?open=${this._dialog.open}
        .label=${this._localize("dashboard.action_encryption_key_title")}
        @request-close=${this._dialog.onRequestClose}
        @after-hide=${this._onAfterHide}
      >
        <div class="content">
          ${this._encryptionKey ? this._renderKey() : this._renderNoKey()}
        </div>
      </esphome-base-dialog>
    `;
  }

  private _onAfterHide = () => {
    this._encryptionKey = "";
  };

  private _renderKey() {
    const key = this._encryptionKey;
    const display = this._visible
      ? key
      : key.length > 8
        ? key.slice(0, 4) + "••••••••••••••••" + key.slice(-4)
        : "••••••••••••••••";

    const toggleLabel = this._localize(
      this._visible
        ? "dashboard.action_encryption_key_hide"
        : "dashboard.action_encryption_key_show"
    );
    const copyLabel = this._localize("dashboard.action_encryption_key_copy");

    return html`
      <div class="key-wrap">
        <span class="key-value">${display}</span>
        <button
          class="key-btn"
          title=${toggleLabel}
          aria-label=${toggleLabel}
          @click=${() => {
            this._visible = !this._visible;
          }}
        >
          <wa-icon library="mdi" name=${this._visible ? "eye-off" : "eye"}></wa-icon>
        </button>
        <button
          class="key-btn"
          title=${copyLabel}
          aria-label=${copyLabel}
          @click=${this._copy}
        >
          <wa-icon library="mdi" name="content-copy"></wa-icon>
        </button>
      </div>
    `;
  }

  private _renderNoKey() {
    return html`
      <p class="no-key">${this._localize("dashboard.action_encryption_key_not_found")}</p>
    `;
  }

  private async _copy() {
    // Goes through ``copyToClipboard`` so the button works on
    // plain-HTTP origins where ``navigator.clipboard.writeText``
    // throws (HA-addon direct port, container-on-LAN deploys
    // reaching the dashboard via ``http://192.168.x.x:6052``).
    if (await copyToClipboard(this._encryptionKey)) {
      notifySuccess(this._localize("dashboard.action_encryption_key_copied"));
    }
    // No failure toast here: the eye toggle reveals the key in the
    // dialog body, so the user can select and copy it by hand if
    // the button failed.
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-encryption-key-dialog": ESPHomeEncryptionKeyDialog;
  }
}
