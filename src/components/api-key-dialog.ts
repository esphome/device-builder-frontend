import { consume } from "@lit/context";
import { mdiContentCopy, mdiEye, mdiEyeOff } from "@mdi/js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import toast from "sonner-js";
import type { LocalizeFunc } from "../common/localize.js";
import { localizeContext } from "../context/index.js";
import { espHomeStyles } from "../styles/shared.js";
import { registerMdiIcons } from "../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/dialog/dialog.js";
import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({
  "content-copy": mdiContentCopy,
  eye: mdiEye,
  "eye-off": mdiEyeOff,
});

@customElement("esphome-api-key-dialog")
export class ESPHomeApiKeyDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @property()
  apiKey = "";

  @state()
  private _visible = false;

  @query("wa-dialog")
  private _dialog!: HTMLElement & { open: boolean };

  static styles = [
    espHomeStyles,
    css`
      wa-dialog {
        --width: 480px;
      }

      wa-dialog::part(header) {
        padding: var(--wa-space-l) var(--wa-space-l) var(--wa-space-s);
      }

      wa-dialog::part(title) {
        font-size: var(--wa-font-size-m);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-normal);
      }

      wa-dialog::part(close-button__base) {
        background: transparent;
        border: none;
        box-shadow: none;
      }

      wa-dialog::part(body) {
        padding: 0 var(--wa-space-l);
      }

      wa-dialog::part(footer) {
        display: none;
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
        transition: background 0.12s, color 0.12s;
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
    this.apiKey = key;
    this._visible = false;
    this._dialog.open = true;
  }

  close() {
    this._dialog.open = false;
  }

  protected render() {
    return html`
      <wa-dialog label=${this._localize("dashboard.action_api_key_title")} light-dismiss>
        <div class="content">
          ${this.apiKey ? this._renderKey() : this._renderNoKey()}
        </div>
      </wa-dialog>
    `;
  }

  private _renderKey() {
    const masked = this._visible
      ? this.apiKey
      : this.apiKey.slice(0, 4) + "••••••••••••••••" + this.apiKey.slice(-4);

    return html`
      <div class="key-wrap">
        <span class="key-value">${masked}</span>
        <button
          class="key-btn"
          title=${this._localize(this._visible ? "dashboard.action_api_key_hide" : "dashboard.action_api_key_show")}
          @click=${() => { this._visible = !this._visible; }}
        >
          <wa-icon library="mdi" name=${this._visible ? "eye-off" : "eye"}></wa-icon>
        </button>
        <button
          class="key-btn"
          title=${this._localize("dashboard.action_api_key_copy")}
          @click=${this._copy}
        >
          <wa-icon library="mdi" name="content-copy"></wa-icon>
        </button>
      </div>
    `;
  }

  private _renderNoKey() {
    return html`
      <p class="no-key">${this._localize("dashboard.action_api_key_not_found")}</p>
    `;
  }

  private async _copy() {
    try {
      await navigator.clipboard.writeText(this.apiKey);
      toast.success(this._localize("dashboard.action_api_key_copied"), { richColors: true });
    } catch {
      // Clipboard API not available
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-api-key-dialog": ESPHomeApiKeyDialog;
  }
}
