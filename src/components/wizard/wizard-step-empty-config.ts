import { consume } from "@lit/context";
import { LitElement, css, html, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { localizeContext } from "../../context/index.js";
import { inputStyles } from "../../styles/inputs.js";
import { espHomeStyles } from "../../styles/shared.js";
import { EnterController } from "../../util/enter-controller.js";
import { fireEvent } from "../../util/fire-event.js";

@customElement("esphome-wizard-step-empty-config")
export class ESPHomeWizardStepEmptyConfig extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  // Set by the parent dialog; the step stays mounted while the dialog is
  // hidden, so the Enter listener follows this rather than connectedCallback.
  @property({ type: Boolean }) active = false;

  @state()
  private _name = "";

  // Enter finishes setup once a name is entered.
  private _enter = new EnterController(this, () => {
    if (this._name.trim()) this._next();
  });

  protected willUpdate(changed: PropertyValues): void {
    if (changed.has("active")) this._enter.set(this.active);
  }

  static styles = [
    espHomeStyles,
    inputStyles,
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

      .actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--wa-space-s);
      }

      .btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 0 14px;
        height: 36px;
        box-sizing: border-box;
        font-size: var(--wa-font-size-xs);
        font-weight: var(--wa-font-weight-bold);
        font-family: inherit;
        border-radius: var(--wa-border-radius-m);
        cursor: pointer;
        border: var(--wa-border-width-s) solid transparent;
        transition:
          background 0.12s,
          border-color 0.12s;
      }

      .btn-cancel {
        background: var(--wa-color-surface-raised);
        border-color: var(--wa-color-surface-border);
        color: var(--wa-color-text-normal);
      }

      .btn-cancel:hover {
        background: var(--wa-color-surface-lowered);
        border-color: var(--wa-color-text-quiet);
      }

      .btn-next {
        background: var(--esphome-primary);
        color: var(--esphome-on-primary);
      }

      .btn-next:hover {
        background: var(--esphome-primary-hover);
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
          ${this._localize("wizard.finish_setup")}
        </button>
      </div>
    `;
  }

  private _cancel() {
    fireEvent(this, "next-step", "method");
  }

  private _next() {
    fireEvent(this, "create-empty-config", { name: this._name });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-wizard-step-empty-config": ESPHomeWizardStepEmptyConfig;
  }
}
