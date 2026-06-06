import { consume } from "@lit/context";
import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { localizeContext } from "../../context/index.js";
import { dialogActionButtonStyles } from "../../styles/dialog-action-buttons.js";
import { espHomeStyles } from "../../styles/shared.js";

/** Asks before replacing an existing device's config on a YAML upload.
 *  Overwriting keeps the device's labels / comment / board; deleting it
 *  first is the explicit start-fresh path. Emits 'overwrite-device'. */
@customElement("esphome-wizard-step-overwrite-device")
export class ESPHomeWizardStepOverwriteDevice extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  /** Name of the existing device (its hostname slug, as shown on the
   *  device card), not the YAML filename. */
  @property({ type: String }) deviceName = "";

  static styles = [
    espHomeStyles,
    dialogActionButtonStyles,
    css`
      :host {
        display: block;
      }

      p {
        margin: 0 0 var(--wa-space-l);
        color: var(--wa-color-text-normal);
        font-size: var(--wa-font-size-s);
      }

      .actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--wa-space-s);
      }
    `,
  ];

  protected render() {
    return html`
      <p>
        ${this._localize("wizard.overwrite_device_message", {
          name: this.deviceName,
        })}
      </p>

      <div class="actions">
        <button class="btn btn--cancel" @click=${this._cancel}>
          ${this._localize("wizard.cancel")}
        </button>
        <button class="btn btn--primary" @click=${this._confirm}>
          ${this._localize("wizard.overwrite_device_button")}
        </button>
      </div>
    `;
  }

  private _cancel() {
    this.dispatchEvent(
      new CustomEvent("next-step", {
        detail: "method",
        bubbles: true,
        composed: true,
      })
    );
  }

  private _confirm() {
    this.dispatchEvent(
      new CustomEvent("overwrite-device", { bubbles: true, composed: true })
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-wizard-step-overwrite-device": ESPHomeWizardStepOverwriteDevice;
  }
}
