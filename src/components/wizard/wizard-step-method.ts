import { consume } from "@lit/context";
import { mdiChevronDown, mdiChevronRight, mdiCog } from "@mdi/js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { localizeContext } from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import { FileDropController } from "../../util/file-drop-controller.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { ACCEPTED_UPLOAD_EXTENSIONS } from "../../util/upload-file-types.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({
  cog: mdiCog,
  "chevron-right": mdiChevronRight,
  "chevron-down": mdiChevronDown,
});

@customElement("esphome-wizard-step-method")
export class ESPHomeWizardStepMethod extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @query("#file-input")
  private _fileInput!: HTMLInputElement;

  // Owned by the parent dialog so it survives step changes (the dialog
  // unmounts this element when navigating away and back).
  @property({ type: Boolean })
  advancedOpen = false;

  private _drop = new FileDropController(this, (file) => this._sendImportFile(file));

  static styles = [
    espHomeStyles,
    css`
      :host {
        display: block;
      }

      .step-heading {
        display: flex;
        align-items: center;
        gap: var(--wa-space-s);
        margin-bottom: var(--wa-space-l);
      }

      .step-heading wa-icon {
        font-size: 28px;
        color: var(--wa-color-text-quiet);
      }

      .step-heading h2 {
        margin: 0;
        font-size: var(--wa-font-size-l);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-normal);
      }

      .method-layout {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-m);
      }

      .option-cards {
        display: grid;
        grid-template-columns: 1fr;
        grid-auto-rows: 1fr;
        gap: var(--wa-space-m);
      }

      .option-card {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--wa-space-m) var(--wa-space-l);
        border: var(--wa-border-width-m) solid var(--esphome-primary-light);
        border-radius: var(--wa-border-radius-l);
        cursor: pointer;
        background: none;
        width: 100%;
        text-align: left;
        box-sizing: border-box;
        transition:
          border-color var(--wa-transition-normal) var(--wa-transition-easing),
          background var(--wa-transition-normal) var(--wa-transition-easing);
      }

      .option-card:hover {
        border-color: var(--esphome-primary);
        background: var(--esphome-tint-faint);
      }

      .option-card-text h3 {
        margin: 0 0 var(--wa-space-s);
        font-size: var(--wa-font-size-m);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-normal);
      }

      .option-card-text p {
        margin: 0;
        font-size: var(--wa-font-size-s);
        color: var(--wa-color-text-quiet);
        min-height: 2lh;
      }

      .option-card wa-icon {
        font-size: var(--wa-font-size-xl);
        color: var(--esphome-primary);
        flex-shrink: 0;
      }

      .advanced-toggle {
        display: inline-flex;
        align-items: center;
        gap: var(--wa-space-2xs);
        color: var(--esphome-primary);
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
        cursor: pointer;
        text-decoration: underline;
        background: none;
        border: none;
        padding: var(--wa-space-s);
      }

      .advanced-toggle:hover {
        text-decoration: none;
      }

      .advanced-toggle wa-icon {
        font-size: var(--wa-font-size-s);
        color: var(--esphome-primary);
        transition: transform var(--wa-transition-normal) var(--wa-transition-easing);
      }

      .advanced-toggle[aria-expanded="true"] wa-icon {
        transform: rotate(180deg);
      }

      .drop-hint {
        margin-top: var(--wa-space-xl);
        text-align: center;
        font-size: var(--wa-font-size-s);
        color: var(--wa-color-text-quiet);
        font-style: italic;
      }

      /* Negative margin + matching padding keep the highlight outline
         from shifting the step content when a file drag hovers. */
      .drop-zone {
        margin: calc(-1 * var(--wa-space-s));
        padding: var(--wa-space-s);
        border-radius: var(--wa-border-radius-l);
      }

      .drop-zone--active {
        outline: var(--wa-border-width-m) dashed var(--esphome-primary);
        outline-offset: calc(-1 * var(--wa-border-width-m));
        background: var(--esphome-tint-faint);
      }

      .drop-zone--active .drop-hint {
        color: var(--esphome-primary);
      }
    `,
  ];

  protected render() {
    return html`
      <div
        class=${classMap({ "drop-zone": true, "drop-zone--active": this._drop.dragging })}
      >
        <div class="step-heading">
          <wa-icon library="mdi" name="cog"></wa-icon>
          <h2>${this._localize("wizard.how_create")}</h2>
        </div>

        <div class="method-layout">
          <div class="option-cards">
            <button class="option-card" @click=${this._goToBoard}>
              <div class="option-card-text">
                <h3>${this._localize("wizard.create_new")}</h3>
                <p>${this._localize("wizard.create_new_desc")}</p>
              </div>
              <wa-icon library="mdi" name="chevron-right"></wa-icon>
            </button>
          </div>

          <button
            class="advanced-toggle"
            aria-expanded=${this.advancedOpen}
            @click=${this._toggleAdvanced}
          >
            ${this._localize("wizard.advanced_options")}
            <wa-icon library="mdi" name="chevron-down"></wa-icon>
          </button>

          ${this.advancedOpen
            ? html`<div class="option-cards">${this._renderAdvancedOptions()}</div>`
            : nothing}
        </div>

        <p class="drop-hint">${this._localize("wizard.drop_yaml")}</p>

        <input
          id="file-input"
          type="file"
          accept=${ACCEPTED_UPLOAD_EXTENSIONS.join(",")}
          hidden
          @change=${this._onFileSelected}
        />
      </div>
    `;
  }

  private _renderAdvancedOptions() {
    return html`
      <button class="option-card" @click=${this._importFile}>
        <div class="option-card-text">
          <h3>${this._localize("wizard.import_file")}</h3>
          <p>${this._localize("wizard.import_file_desc")}</p>
        </div>
        <wa-icon library="mdi" name="chevron-right"></wa-icon>
      </button>

      <button class="option-card" @click=${this._emptyConfig}>
        <div class="option-card-text">
          <h3>${this._localize("wizard.empty_config")}</h3>
          <p>${this._localize("wizard.empty_config_desc")}</p>
        </div>
        <wa-icon library="mdi" name="chevron-right"></wa-icon>
      </button>
    `;
  }

  private _toggleAdvanced() {
    // Just signal intent; the dialog owns the flag (it outlives this element)
    // and flips it.
    this.dispatchEvent(
      new CustomEvent("toggle-advanced", { bubbles: true, composed: true })
    );
  }

  private _goToBoard() {
    this.dispatchEvent(
      new CustomEvent("next-step", { detail: "board", bubbles: true, composed: true })
    );
  }

  private _importFile() {
    this._fileInput.click();
  }

  private _onFileSelected() {
    const file = this._fileInput.files?.[0];
    if (!file) return;

    // Reset so the same file can be re-selected if needed
    this._fileInput.value = "";
    this._sendImportFile(file);
  }

  private _sendImportFile(file: File) {
    // Imports don't ask for a board — the YAML already declares its platform.
    // The dialog reads the file and creates the device immediately.
    this.dispatchEvent(
      new CustomEvent("import-file", {
        detail: { file },
        bubbles: true,
        composed: true,
      })
    );
  }

  private _emptyConfig() {
    this.dispatchEvent(
      new CustomEvent("next-step", {
        detail: { step: "empty-config", method: "empty" },
        bubbles: true,
        composed: true,
      })
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-wizard-step-method": ESPHomeWizardStepMethod;
  }
}
