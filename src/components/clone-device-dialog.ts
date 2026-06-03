import { consume } from "@lit/context";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { LocalizeFunc } from "../common/localize.js";
import { localizeContext } from "../context/index.js";
import { inputStyles } from "../styles/inputs.js";
import { espHomeStyles } from "../styles/shared.js";
import { getDeviceNameWarning, validateDeviceName } from "../util/config-validation.js";
import { EnterController } from "../util/enter-controller.js";
import { renderInlineError } from "../util/render-error.js";

import "./base-dialog.js";

/**
 * Clone-device dialog. Two inputs:
 *
 * - **Hostname** (``new_name``) — the cloned config's
 *   ``esphome.name``. Validated through the same
 *   ``validateDeviceName`` / ``getDeviceNameWarning`` pipeline as
 *   rename, so warnings about underscores / hyphens / etc. surface
 *   here too.
 * - **Friendly name** — the cloned config's ``esphome.friendly_name``.
 *   Optional; the backend defaults to ``friendly_name_slugify(new_name)``
 *   when omitted, so leaving the field blank still produces a
 *   distinct label.
 *
 * Emits ``clone-confirm`` on submit with
 * ``{newName, newFriendlyName}`` (the friendly name is ``""`` when
 * the user left the field blank — the page handler decides whether
 * to forward as ``undefined`` so the backend defaults kick in).
 */
@customElement("esphome-clone-device-dialog")
export class ESPHomeCloneDeviceDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @property()
  sourceName = "";

  @state()
  private _name = "";

  @state()
  private _friendlyName = "";

  @state()
  private _open = false;

  static styles = [
    espHomeStyles,
    inputStyles,
    css`
      esphome-base-dialog {
        --width: 460px;
      }

      esphome-base-dialog::part(header) {
        padding: var(--wa-space-l) var(--wa-space-l) var(--wa-space-s);
      }

      esphome-base-dialog::part(title) {
        font-size: var(--wa-font-size-m);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-normal);
      }

      esphome-base-dialog::part(close-button__base) {
        background: transparent;
        border: none;
        box-shadow: none;
      }

      esphome-base-dialog::part(body) {
        padding: 0 var(--wa-space-l);
      }

      .field {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-xs);
        padding-bottom: var(--wa-space-m);
      }

      label {
        font-size: var(--wa-font-size-xs);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-quiet);
      }

      .helper {
        font-size: var(--wa-font-size-xs);
        color: var(--wa-color-text-quiet);
        margin-top: var(--wa-space-2xs);
      }

      .actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--wa-space-s);
        padding: var(--wa-space-m) 0 var(--wa-space-l);
      }

      .btn {
        padding: 8px 18px;
        border-radius: var(--wa-border-radius-m);
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
        font-family: inherit;
        cursor: pointer;
        border: none;
        transition: background 0.12s;
      }

      .btn--cancel {
        background: var(--wa-color-surface-lowered);
        color: var(--wa-color-text-normal);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
      }

      .btn--cancel:hover {
        background: var(--wa-color-surface-border);
      }

      .btn--primary {
        background: var(--esphome-primary);
        color: var(--esphome-on-primary);
      }

      .btn--primary:hover:not(:disabled) {
        background: var(--esphome-primary-hover);
      }

      .btn--primary:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .field-error {
        color: var(--esphome-error);
        font-size: var(--wa-font-size-xs);
        margin-top: var(--wa-space-2xs);
      }

      .field-warning {
        color: var(--esphome-warning, #d97706);
        font-size: var(--wa-font-size-xs);
        margin-top: var(--wa-space-2xs);
      }
    `,
  ];

  // One-shot latch: close() only starts the hide animation, so the
  // EnterController listener stays live until wa-after-hide; without this a
  // held Enter re-enters _confirm and dispatches clone-confirm twice.
  private _resolved = false;

  // Enter confirms; _confirm self-guards on empty / same / invalid.
  private _enter = new EnterController(this, () => this._confirm());

  open(sourceName: string) {
    this.sourceName = sourceName;
    this._name = "";
    this._friendlyName = "";
    this._resolved = false;
    this._open = true;
    this._enter.set(true);
  }

  close() {
    this._open = false;
  }

  // Flip the reactive flag on the initiating close so a re-render can't
  // re-assert ?open mid-hide; teardown (the EnterController unbind) stays
  // in after-hide. esphome-base-dialog never mutates its own open in
  // response to user actions, so the host owns flipping _open here.
  private _onRequestClose = (): void => {
    this._open = false;
  };

  private _onAfterHide = (): void => {
    this._enter.set(false);
  };

  protected render() {
    const trimmedName = this._name.trim();
    const sameAsSource = trimmedName === this.sourceName;
    const showsValidation = trimmedName.length > 0;
    // Same gate the rename dialog uses, plus a sameness check —
    // the backend rejects ``new_name == source`` anyway, but
    // catching it client-side keeps the submit button disabled
    // instead of letting the user fire and see an error toast.
    const err =
      sameAsSource && showsValidation
        ? { code: "dashboard.action_clone_same_name", params: undefined }
        : showsValidation
          ? validateDeviceName(trimmedName)
          : null;
    const warning = showsValidation && !err ? getDeviceNameWarning(trimmedName) : null;
    const canSubmit = trimmedName.length > 0 && !err;

    return html`
      <esphome-base-dialog
        ?open=${this._open}
        .label=${this._localize("dashboard.action_clone_title", {
          name: this.sourceName,
        })}
        @request-close=${this._onRequestClose}
        @after-hide=${this._onAfterHide}
      >
        <div class="field">
          <label for="clone-new-name"
            >${this._localize("dashboard.action_clone_name_label")}</label
          >
          <input
            id="clone-new-name"
            type="text"
            class=${err ? "invalid" : ""}
            .value=${this._name}
            placeholder=${this.sourceName}
            @input=${(e: Event) => {
              this._name = (e.target as HTMLInputElement).value;
            }}
          />
          ${err
            ? renderInlineError(this._localize(err.code, err.params))
            : warning
              ? html`<span class="field-warning"
                  >${this._localize(warning.code, warning.params)}</span
                >`
              : nothing}
        </div>
        <div class="field">
          <label for="clone-friendly-name"
            >${this._localize("dashboard.action_clone_friendly_name_label")}</label
          >
          <input
            id="clone-friendly-name"
            type="text"
            .value=${this._friendlyName}
            placeholder=${this._localize(
              "dashboard.action_clone_friendly_name_placeholder"
            )}
            @input=${(e: Event) => {
              this._friendlyName = (e.target as HTMLInputElement).value;
            }}
          />
          <span class="helper"
            >${this._localize("dashboard.action_clone_friendly_name_helper")}</span
          >
        </div>
        <div class="actions">
          <button class="btn btn--cancel" @click=${this.close}>
            ${this._localize("layout.cancel")}
          </button>
          <button
            class="btn btn--primary"
            ?disabled=${!canSubmit}
            @click=${this._confirm}
          >
            ${this._localize("dashboard.action_clone_confirm")}
          </button>
        </div>
      </esphome-base-dialog>
    `;
  }

  private _confirm = () => {
    if (this._resolved) return;
    const newName = this._name.trim();
    if (!newName || newName === this.sourceName) return;
    if (validateDeviceName(newName)) return;
    this._resolved = true;
    this.close();
    this.dispatchEvent(
      new CustomEvent<{ newName: string; newFriendlyName: string }>("clone-confirm", {
        detail: { newName, newFriendlyName: this._friendlyName.trim() },
        bubbles: true,
        composed: true,
      })
    );
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-clone-device-dialog": ESPHomeCloneDeviceDialog;
  }
}
