import { consume } from "@lit/context";
import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { localizeContext } from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";

@customElement("esphome-wizard-step-empty-config")
export class ESPHomeWizardStepEmptyConfig extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @state()
  private _name = "";

  static styles = [
    espHomeStyles,
    css`
      :host {
        display: block;
      }

      .field {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-xs);
        margin-bottom: var(--wa-space-xl);
      }

      label {
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-normal);
      }

      input {
        width: 100%;
        padding: var(--wa-space-s) var(--wa-space-m);
        font-size: var(--wa-font-size-m);
        font-family: inherit;
        color: var(--wa-color-text-normal);
        background: var(--wa-color-surface-default);
        border: var(--wa-border-width-m) solid var(--esphome-primary-light);
        border-radius: var(--wa-border-radius-m);
        box-sizing: border-box;
        outline: none;
        transition: border-color var(--wa-transition-normal) var(--wa-transition-easing);
      }

      input:focus {
        border-color: var(--esphome-primary);
      }

      .actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--wa-space-s);
      }

      .btn {
        padding: var(--wa-space-s) var(--wa-space-l);
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
        font-family: inherit;
        border-radius: var(--wa-border-radius-m);
        cursor: pointer;
        border: var(--wa-border-width-m) solid transparent;
        transition:
          background var(--wa-transition-normal) var(--wa-transition-easing),
          border-color var(--wa-transition-normal) var(--wa-transition-easing);
      }

      .btn-cancel {
        background: none;
        border-color: var(--esphome-primary-light);
        color: var(--wa-color-text-normal);
      }

      .btn-cancel:hover {
        border-color: var(--esphome-primary);
        background: color-mix(in srgb, var(--esphome-primary), transparent 95%);
      }

      .btn-next {
        background: var(--esphome-primary);
        color: var(--esphome-on-primary);
      }

      .btn-next:hover {
        background: color-mix(in srgb, var(--esphome-primary), black 10%);
      }

      .btn-next:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    `,
  ];

  protected render() {
    return html`
      <div class="field">
        <label for="device-name">${this._localize("wizard.device_name")}</label>
        <input
          id="device-name"
          type="text"
          .value=${this._name}
          placeholder=${this._localize("wizard.device_name_placeholder")}
          @input=${(e: InputEvent) => {
            this._name = (e.target as HTMLInputElement).value;
          }}
        />
      </div>

      <div class="actions">
        <button class="btn btn-cancel" @click=${this._cancel}>
          ${this._localize("wizard.cancel")}
        </button>
        <button class="btn btn-next" ?disabled=${!this._name.trim()} @click=${this._next}>
          ${this._localize("wizard.next")}
        </button>
      </div>
    `;
  }

  private _cancel() {
    this.dispatchEvent(
      new CustomEvent("next-step", { detail: "board", bubbles: true, composed: true })
    );
  }

  private _next() {
    this.dispatchEvent(
      new CustomEvent("create-empty-config", {
        detail: { name: this._name },
        bubbles: true,
        composed: true,
      })
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-wizard-step-empty-config": ESPHomeWizardStepEmptyConfig;
  }
}
