import { consume } from "@lit/context";
import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { localizeContext } from "../../context/index.js";
import { dialogActionButtonStyles } from "../../styles/dialog-action-buttons.js";
import { espHomeStyles } from "../../styles/shared.js";

/** Terminal result of a bundle import that left some existing files in
 *  place, so a partial import reads as partial rather than a silent
 *  success. Emits 'open-device' when the user continues to the editor. */
@customElement("esphome-wizard-step-import-partial")
export class ESPHomeWizardStepImportPartial extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  /** Existing files the import kept (did not overwrite). */
  @property({ type: Array }) kept: string[] = [];

  static styles = [
    espHomeStyles,
    dialogActionButtonStyles,
    css`
      :host {
        display: block;
      }

      p {
        margin: 0 0 var(--wa-space-m);
        color: var(--wa-color-text-normal);
        font-size: var(--wa-font-size-s);
      }

      ul.kept {
        margin: 0 0 var(--wa-space-l);
        padding-left: var(--wa-space-l);
        max-height: 200px;
        overflow-y: auto;
        font-family: var(--wa-font-family-code, monospace);
        font-size: var(--wa-font-size-s);
        color: var(--wa-color-text-quiet);
        word-break: break-all;
      }

      .actions {
        display: flex;
        justify-content: flex-end;
      }
    `,
  ];

  protected render() {
    return html`
      <p>${this._localize("wizard.import_partial_desc", { count: this.kept.length })}</p>
      <ul class="kept">
        ${this.kept.map((p) => html`<li>${p}</li>`)}
      </ul>
      <div class="actions">
        <button class="btn btn--primary" @click=${this._open}>
          ${this._localize("wizard.import_partial_open")}
        </button>
      </div>
    `;
  }

  private _open() {
    this.dispatchEvent(new CustomEvent("open-device", { bubbles: true, composed: true }));
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-wizard-step-import-partial": ESPHomeWizardStepImportPartial;
  }
}
