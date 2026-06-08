/**
 * The selected secret's value affordance, shown beneath the picker trigger.
 * When the key isn't in ``secrets.yaml`` (``present`` false) it warns and offers
 * inline creation; when it exists it reveals the value (eye/copy) with an inline
 * edit. Any write refreshes the shared key cache so the picker re-evaluates —
 * the field already references ``!secret <secretKey>``, so nothing is re-emitted.
 */
import { consume } from "@lit/context";
import { mdiAlert, mdiPencil } from "@mdi/js";
import { css, html, LitElement, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import toast from "sonner-js";
import type { ESPHomeAPI } from "../../api/esphome-api.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { apiContext, localizeContext } from "../../context/index.js";
import {
  ensureSecretWithToast,
  setSecretWithToast,
} from "../../util/ensure-secret-with-toast.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { secretValueFromYaml } from "../../util/secret-eligibility.js";
import type { PasswordInputValueChange } from "./password-input-event.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "../secret-reveal.js";
import "./password-input.js";

registerMdiIcons({ alert: mdiAlert, pencil: mdiPencil });

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

  @state() private _editing = false;
  @state() private _draftValue = "";
  @state() private _busy = false;

  protected willUpdate(changed: PropertyValues): void {
    // Drop edit state on a new target OR a present flip: a stale draft mustn't
    // leak across keys, and an edit begun in the brief pre-keys-load window
    // (optimistically present) must not resurface as an empty editor once the
    // key resolves missing → created → present again.
    if (changed.has("secretKey") || changed.has("present")) {
      this._editing = false;
      this._draftValue = "";
      this._busy = false;
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

    .view {
      padding-left: var(--wa-space-2xs);
      font-size: var(--wa-font-size-xs);
      color: var(--wa-color-text-quiet);
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

    .edit {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
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

    .edit:hover {
      background: var(--wa-color-surface-border);
      color: var(--wa-color-text-normal);
    }

    .edit wa-icon {
      font-size: 15px;
    }

    .save {
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

    .save:hover:not(:disabled) {
      opacity: 0.9;
    }

    .cancel {
      padding: 0 14px;
      min-height: var(--wa-form-control-height);
      box-sizing: border-box;
      border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
      border-radius: var(--wa-border-radius-m);
      background: transparent;
      color: var(--wa-color-text-normal);
      font-family: inherit;
      font-size: var(--wa-font-size-s);
      cursor: pointer;
    }

    .save:disabled,
    .cancel:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  `;

  protected render() {
    if (!this.present) return this._renderCreate();
    return this._editing ? this._renderEdit() : this._renderView();
  }

  /** Existing secret: reveal the value (eye/copy) with an inline edit. */
  private _renderView() {
    return html`<div class="row view">
      <span>${this._localize("device.secret_picker_value")}</span>
      <esphome-secret-reveal
        .resolve=${this._resolve}
        resetKey=${this.secretKey}
      ></esphome-secret-reveal>
      <button
        class="edit"
        type="button"
        title=${this._localize("device.secret_picker_edit")}
        aria-label=${this._localize("device.secret_picker_edit")}
        @click=${this._startEdit}
      >
        <wa-icon library="mdi" name="pencil"></wa-icon>
      </button>
    </div>`;
  }

  /** Missing secret: warn and offer to create it inline. */
  private _renderCreate() {
    return html`<div class="fix">
      <span class="msg" role="alert">
        <wa-icon library="mdi" name="alert"></wa-icon>
        ${this._localize("device.secret_picker_missing", { key: this.secretKey })}
      </span>
      ${this._renderField(this._create, "device.secret_picker_missing_create", false)}
    </div>`;
  }

  /** Existing secret being edited: prefilled field with save / cancel. */
  private _renderEdit() {
    return html`<div class="fix">
      ${this._renderField(this._save, "device.secret_picker_save", true)}
    </div>`;
  }

  private _renderField(submit: () => void, submitKey: string, cancelable: boolean) {
    return html`<div class="row">
      <esphome-password-input
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
            submit();
          }
        }}
      ></esphome-password-input>
      <button class="save" type="button" ?disabled=${this._busy} @click=${submit}>
        ${this._localize(submitKey)}
      </button>
      ${cancelable
        ? html`<button
            class="cancel"
            type="button"
            ?disabled=${this._busy}
            @click=${this._cancelEdit}
          >
            ${this._localize("device.secret_picker_cancel")}
          </button>`
        : nothing}
    </div>`;
  }

  /** Read the selected secret's current value from secrets.yaml. */
  private _resolve = async (): Promise<string | null> => {
    if (!this._api || !this.secretKey) return null;
    try {
      const yaml = await this._api.getConfig(SECRETS_FILE);
      return secretValueFromYaml(yaml, this.secretKey);
    } catch {
      toast.error(this._localize("device.secret_picker_reveal_error"), {
        richColors: true,
      });
      return null;
    }
  };

  /** Prefill the editor with the current value so the user edits, not retypes. */
  private _startEdit = async (): Promise<void> => {
    this._draftValue = (await this._resolve()) ?? "";
    this._editing = true;
  };

  private _cancelEdit = (): void => {
    this._editing = false;
    this._draftValue = "";
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
    void this._run(
      (api) =>
        setSecretWithToast(api, this.secretKey, this._draftValue, this._localize, {
          savedKey: "device.secret_picker_saved",
          errorKey: "device.secret_picker_save_error",
          logLabel: "Secret save failed",
        }),
      () => {
        this._editing = false;
        this._draftValue = "";
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
