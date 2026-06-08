/**
 * The selected secret's value affordance, shown beneath the picker trigger.
 * When the key isn't in ``secrets.yaml`` (``present`` false) it warns and offers
 * inline creation; when it exists the value is directly editable (masked, with a
 * reveal toggle) and Save persists a change. Any write refreshes the shared key
 * cache so the picker re-evaluates — the field already references
 * ``!secret <secretKey>``, so nothing is re-emitted.
 */
import { consume } from "@lit/context";
import { mdiAlert, mdiContentCopy } from "@mdi/js";
import { css, html, LitElement, type PropertyValues } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import toast from "sonner-js";
import type { ESPHomeAPI } from "../../api/esphome-api.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { apiContext, localizeContext } from "../../context/index.js";
import { copyToClipboard } from "../../util/copy-to-clipboard.js";
import {
  ensureSecretWithToast,
  setSecretWithToast,
} from "../../util/ensure-secret-with-toast.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { isSharedSecret, secretValueFromYaml } from "../../util/secret-eligibility.js";
import type { ESPHomeConfirmDialog } from "../confirm-dialog.js";
import type { PasswordInputValueChange } from "./password-input-event.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "../confirm-dialog.js";
import "./password-input.js";

registerMdiIcons({ alert: mdiAlert, "content-copy": mdiContentCopy });

const SECRETS_FILE = "secrets.yaml";

@customElement("esphome-secret-value")
export class ESPHomeSecretValue extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: apiContext, subscribe: true })
  @state()
  private _api?: ESPHomeAPI;

  /** The secret key the field references. */
  @property({ attribute: "secret-key" })
  secretKey = "";

  /** Whether the key exists in secrets.yaml. False → offer to create it. */
  @property({ type: Boolean })
  present = false;

  /** This device's resolved node name — distinguishes a shared secret (warn on
   *  overwrite) from this device's own ``<host>__…`` secret. */
  @property({ attribute: "device-name" })
  deviceName = "";

  @query("esphome-confirm-dialog")
  private _confirmDialog?: ESPHomeConfirmDialog;

  /** The value being edited. */
  @state() private _draftValue = "";
  /** The stored value last read for *present*; ``null`` until loaded (or N/A
   *  while missing). Save is enabled only when the draft diverges from it. */
  @state() private _stored: string | null = null;
  @state() private _busy = false;
  /** Cancels a stale load when the target changes mid-fetch. */
  private _loadToken = 0;

  protected willUpdate(changed: PropertyValues): void {
    // Reset on a new target OR a present flip: a stale draft mustn't leak across
    // keys, and the loaded value must be refetched (e.g. after an inline create
    // flips present false → true).
    if (changed.has("secretKey") || changed.has("present")) {
      this._draftValue = "";
      this._stored = null;
      this._busy = false;
      this._loadToken++;
    }
  }

  protected updated(): void {
    // Prefill the editable field with the stored value once present + ready.
    if (this.present && this.secretKey && this._api && this._stored === null) {
      void this._loadStored();
    }
  }

  static styles = css`
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

    /* esphome-password-input is display:block; flex so it shares the row. */
    esphome-password-input {
      flex: 1;
      min-width: 0;
    }

    .copy {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      flex-shrink: 0;
      padding: 0;
      border: none;
      border-radius: var(--wa-border-radius-m);
      background: transparent;
      color: var(--wa-color-text-quiet);
      cursor: pointer;
      transition:
        background 0.12s,
        color 0.12s;
    }

    .copy:hover {
      background: var(--wa-color-surface-border);
      color: var(--wa-color-text-normal);
    }

    .copy wa-icon {
      font-size: 15px;
    }

    .save {
      padding: 0 14px;
      min-height: var(--wa-form-control-height);
      box-sizing: border-box;
      flex-shrink: 0;
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

    .save:hover:not(:disabled) {
      opacity: 0.9;
    }

    .save:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  `;

  protected render() {
    return this.present ? this._renderEdit() : this._renderCreate();
  }

  /** Existing secret: the value is directly editable; Save when it changes. */
  private _renderEdit() {
    const dirty = this._stored !== null && this._draftValue !== this._stored;
    return html`<div class="row">
        ${this._renderInput()}
        <button
          class="copy"
          type="button"
          title=${this._localize("device.secret_reveal_copy")}
          aria-label=${this._localize("device.secret_reveal_copy")}
          @click=${this._copy}
        >
          <wa-icon library="mdi" name="content-copy"></wa-icon>
        </button>
        <button
          class="save"
          type="button"
          ?disabled=${this._busy || !dirty}
          @click=${this._save}
        >
          ${this._localize("device.secret_picker_save")}
        </button>
      </div>
      <esphome-confirm-dialog
        heading=${this._localize("device.secret_picker_shared_confirm_title")}
        confirm-label=${this._localize("device.secret_picker_save")}
        message=${this._localize("device.secret_picker_shared_confirm_message", {
          key: this.secretKey,
        })}
        @confirm=${this._persist}
      ></esphome-confirm-dialog>`;
  }

  /** Missing secret: warn and offer to create it inline. */
  private _renderCreate() {
    return html`<div class="fix">
      <span class="msg" role="alert">
        <wa-icon library="mdi" name="alert"></wa-icon>
        ${this._localize("device.secret_picker_missing", { key: this.secretKey })}
      </span>
      <div class="row">
        ${this._renderInput()}
        <button class="save" type="button" ?disabled=${this._busy} @click=${this._create}>
          ${this._localize("device.secret_picker_missing_create")}
        </button>
      </div>
    </div>`;
  }

  private _renderInput() {
    return html`<esphome-password-input
      class="value"
      .value=${this._draftValue}
      .disabled=${this._busy}
      .placeholder=${this._localize("device.secret_picker_missing_placeholder")}
      .label=${this._localize("device.secret_picker_value_label", {
        key: this.secretKey,
      })}
      @password-input-change=${(e: CustomEvent<PasswordInputValueChange>) => {
        this._draftValue = e.detail.value;
      }}
      @keydown=${(e: KeyboardEvent) => {
        if (e.key === "Enter") {
          e.preventDefault();
          this.present ? this._save() : this._create();
        }
      }}
    ></esphome-password-input>`;
  }

  /** Load the stored value into the editable field (cancellable). */
  private async _loadStored(): Promise<void> {
    const token = ++this._loadToken;
    let value: string | null = null;
    try {
      const yaml = await this._api!.getConfig(SECRETS_FILE);
      value = secretValueFromYaml(yaml, this.secretKey);
    } catch {
      toast.error(this._localize("device.secret_picker_reveal_error"), {
        richColors: true,
      });
    }
    if (token !== this._loadToken) return; // target changed mid-flight
    this._stored = value ?? "";
    this._draftValue = this._stored;
  }

  private _copy = async (): Promise<void> => {
    if (await copyToClipboard(this._draftValue)) {
      toast.success(this._localize("device.secret_reveal_copied"), { richColors: true });
    }
  };

  private _create = (): void => {
    void this._run(
      (api) =>
        ensureSecretWithToast(api, this.secretKey, this._draftValue, this._localize, {
          createdKey: "device.secret_picker_missing_created",
          errorKey: "device.secret_picker_missing_error",
          logLabel: "Secret create failed",
        }),
      () => {
        this._draftValue = "";
      }
    );
  };

  private _save = (): void => {
    // A shared secret (wifi_*, plain, or another device's) is referenced by
    // other devices, so overwriting it changes the value everywhere — confirm
    // first. This device's own `<host>__…` secret writes straight through.
    if (isSharedSecret(this.secretKey, this.deviceName)) {
      this._confirmDialog?.open();
      return;
    }
    this._persist();
  };

  private _persist = (): void => {
    void this._run(
      (api) =>
        setSecretWithToast(api, this.secretKey, this._draftValue, this._localize, {
          savedKey: "device.secret_picker_saved",
          errorKey: "device.secret_picker_save_error",
          logLabel: "Secret save failed",
        }),
      () => {
        this._stored = this._draftValue; // clears the dirty state
      }
    );
  };

  /** Guard, run a write, and apply *onOk* when it succeeds. */
  private async _run(
    write: (api: ESPHomeAPI) => Promise<boolean>,
    onOk: () => void
  ): Promise<void> {
    const api = this._api;
    if (!api || !this.secretKey || this._busy) return;
    this._busy = true;
    try {
      if (await write(api)) onOk();
    } finally {
      this._busy = false;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-secret-value": ESPHomeSecretValue;
  }
}
