/**
 * Shown beneath the secret picker when a field references a ``!secret`` key
 * that isn't in ``secrets.yaml``: warns, and lets the user create it inline.
 * The write fires ``secrets-saved``, which refreshes the shared key cache so
 * the picker re-evaluates and swaps this for the normal value reveal — the
 * field already references ``!secret <secretKey>``, so nothing is re-emitted.
 */
import { consume } from "@lit/context";
import { mdiAlert } from "@mdi/js";
import { css, html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { ESPHomeAPI } from "../../api/esphome-api.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { apiContext, localizeContext } from "../../context/index.js";
import { inputStyles } from "../../styles/inputs.js";
import { ensureSecretWithToast } from "../../util/ensure-secret-with-toast.js";
import { registerMdiIcons } from "../../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({ alert: mdiAlert });

@customElement("esphome-secret-missing")
export class ESPHomeSecretMissing extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: apiContext, subscribe: true })
  @state()
  private _api?: ESPHomeAPI;

  /** The absent secret key the field references. */
  @property({ attribute: "secret-key" })
  secretKey = "";

  @state() private _draftValue = "";
  @state() private _creating = false;

  static styles = [
    inputStyles,
    css`
      :host {
        display: block;
      }

      .fix {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-2xs);
        padding-left: var(--wa-space-2xs);
      }

      .msg {
        display: flex;
        align-items: center;
        gap: var(--wa-space-2xs);
        font-size: var(--wa-font-size-xs);
        color: var(--wa-color-danger-border, var(--wa-color-danger-60));
      }

      .row {
        display: flex;
        align-items: center;
        gap: var(--wa-space-xs);
      }

      /* The shared inputStyles set width:100%; flex so it shares the row. */
      .value {
        flex: 1;
        min-width: 0;
      }

      .create {
        padding: 0 14px;
        min-height: var(--wa-form-control-height);
        box-sizing: border-box;
        border: var(--wa-border-width-s) solid var(--esphome-primary);
        border-radius: var(--wa-border-radius-m);
        background: var(--esphome-primary);
        color: var(--wa-color-surface-default);
        font-family: inherit;
        font-size: var(--wa-font-size-s);
        cursor: pointer;
        transition:
          opacity 0.12s,
          background 0.12s;
      }

      .create:hover:not(:disabled) {
        opacity: 0.9;
      }

      .create:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    `,
  ];

  protected render() {
    return html`<div class="fix">
      <span class="msg">
        <wa-icon library="mdi" name="alert"></wa-icon>
        ${this._localize("device.secret_picker_missing", { key: this.secretKey })}
      </span>
      <div class="row">
        <input
          class="value"
          type="text"
          .value=${this._draftValue}
          ?disabled=${this._creating}
          placeholder=${this._localize("device.secret_picker_missing_placeholder")}
          @input=${(e: Event) => {
            this._draftValue = (e.target as HTMLInputElement).value;
          }}
          @keydown=${(e: KeyboardEvent) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void this._create();
            }
          }}
        />
        <button
          class="create"
          type="button"
          ?disabled=${this._creating}
          @click=${this._create}
        >
          ${this._localize("device.secret_picker_missing_create")}
        </button>
      </div>
    </div>`;
  }

  /** Write the referenced key to secrets.yaml with the typed value (empty
   *  allowed — a placeholder the user fills later). */
  private _create = async (): Promise<void> => {
    if (!this._api || !this.secretKey || this._creating) return;
    this._creating = true;
    try {
      const ok = await ensureSecretWithToast(
        this._api,
        this.secretKey,
        this._draftValue,
        this._localize,
        {
          createdKey: "device.secret_picker_missing_created",
          errorKey: "device.secret_picker_missing_error",
          logLabel: "Secret create failed",
        }
      );
      if (ok) this._draftValue = "";
    } finally {
      this._creating = false;
    }
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-secret-missing": ESPHomeSecretMissing;
  }
}
