import { consume } from "@lit/context";
import { mdiAlertOutline } from "@mdi/js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { LocalizeFunc } from "../common/localize.js";
import { localizeContext } from "../context/index.js";
import { modalDialogStyles } from "../styles/modal-dialog.js";
import { espHomeStyles } from "../styles/shared.js";
import { DialogOpenController } from "../util/dialog-open-controller.js";
import { EnterController } from "../util/enter-controller.js";
import { registerMdiIcons } from "../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "./base-dialog.js";

registerMdiIcons({ "alert-outline": mdiAlertOutline });

/**
 * Save-time YAML validation prompt.
 *
 * Opens when the user hits Save with a backend-invalid config and
 * gives three exits:
 *
 *  - **Cancel** — bail out, leave the buffer dirty.
 *  - **Go to error** — close the dialog and emit ``goto`` with the
 *    first failing diagnostic's 1-indexed line/col so the page can
 *    feed the existing ``?line=`` deep-link path (highlight +
 *    scroll-into-view + section-switch) at that line.
 *  - **Save anyway** — emit ``save-anyway``; the page runs the
 *    same write the unconditional save used to do.
 *
 * Distinct from ``<esphome-confirm-dialog>`` because that one is
 * binary (cancel + confirm); the "Go to error" exit is the whole
 * point of this prompt and doesn't fit the binary shape.
 */
@customElement("esphome-yaml-validation-dialog")
export class ESPHomeYamlValidationDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  /** Total number of validation/yaml errors in the current buffer. */
  @property({ type: Number }) errorCount = 0;

  /** First error's 1-indexed line, or 0 if unknown. */
  @property({ type: Number }) firstErrorLine = 0;

  /** First error's 1-indexed column, or 0 if unknown. */
  @property({ type: Number }) firstErrorCol = 0;

  /** First error's message, used as a hint under the count. */
  @property() firstErrorMessage = "";

  /** Included file the first error lives in, or "" when it's in the open config. */
  @property() firstErrorFile = "";

  private readonly _dialog = new DialogOpenController(this);

  static styles = [
    espHomeStyles,
    modalDialogStyles,
    css`
      esphome-base-dialog {
        --width: 480px;
      }

      .icon-wrap {
        background: color-mix(in srgb, var(--esphome-error), transparent 88%);
        color: var(--esphome-error);
      }

      .included-file {
        margin-top: var(--wa-space-xs);
        color: var(--wa-color-text-normal);
      }

      .first-error {
        margin-top: var(--wa-space-xs);
        font-family: var(--wa-font-family-code);
        font-size: var(--wa-font-size-2xs);
        color: var(--wa-color-text-normal);
        background: var(--wa-color-surface-lowered);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        border-radius: var(--wa-border-radius-s);
        padding: var(--wa-space-xs) var(--wa-space-s);
        white-space: pre-wrap;
        word-break: break-word;
      }

      .btn--goto {
        background: var(--esphome-primary);
        color: var(--esphome-on-primary);
      }

      .btn--goto:hover:not(:disabled) {
        background: var(--esphome-primary-hover);
      }

      .btn--save-anyway {
        background: var(--esphome-error);
        color: var(--esphome-on-primary);
      }

      .btn--save-anyway:hover {
        background: color-mix(in srgb, var(--esphome-error), black 10%);
      }
    `,
  ];

  private _resolvedExit: "goto" | "save-anyway" | null = null;

  // Enter goes to the first error (the safe path), never force-save.
  private _enter = new EnterController(this, () => {
    if (this._canGoToError) this._goto();
  });

  /** Navigation only works when the error is in the open buffer at a known line. */
  private get _canGoToError(): boolean {
    return this.firstErrorLine > 0 && !this.firstErrorFile;
  }

  open() {
    this._resolvedExit = null;
    this._dialog.open = true;
    this._enter.set(true);
  }

  close() {
    this._dialog.open = false;
  }

  protected render() {
    const message = this._localize("device.yaml_invalid_message", {
      count: this.errorCount,
    });
    const includedFileNote = this.firstErrorFile
      ? this._localize("device.yaml_invalid_in_included_file", {
          file: this.firstErrorFile,
          line: this.firstErrorLine,
        })
      : "";
    return html`
      <esphome-base-dialog
        ?open=${this._dialog.open}
        .label=${this._localize("device.yaml_invalid_title")}
        @request-close=${this._dialog.onRequestClose}
        @after-hide=${this._onAfterHide}
      >
        <div class="body">
          <div class="icon-wrap">
            <wa-icon library="mdi" name="alert-outline"></wa-icon>
          </div>
          <div class="text">
            ${message}
            ${
              includedFileNote
                ? html`<div class="included-file">${includedFileNote}</div>`
                : nothing
            }
            ${
              this.firstErrorMessage
                ? html`<div class="first-error">${this.firstErrorMessage}</div>`
                : nothing
            }
          </div>
        </div>
        <div class="actions">
          <button class="btn btn--cancel" @click=${this.close}>
            ${this._localize("layout.cancel")}
          </button>
          <button
            class="btn btn--goto"
            ?disabled=${!this._canGoToError}
            @click=${this._goto}
          >
            ${this._localize("device.yaml_invalid_go_to_error")}
          </button>
          <button class="btn btn--save-anyway" @click=${this._saveAnyway}>
            ${this._localize("device.yaml_invalid_save_anyway")}
          </button>
        </div>
      </esphome-base-dialog>
    `;
  }

  private _goto() {
    if (!this._canGoToError) return; // error is in an included file we can't open here
    if (this._resolvedExit !== null) return; // a repeated Enter must not dispatch twice
    this._resolvedExit = "goto";
    this.close();
    this.dispatchEvent(
      new CustomEvent("goto", {
        detail: { line: this.firstErrorLine, col: this.firstErrorCol },
        bubbles: true,
        composed: true,
      })
    );
  }

  private _saveAnyway() {
    this._resolvedExit = "save-anyway";
    this.close();
    this.dispatchEvent(new CustomEvent("save-anyway", { bubbles: true, composed: true }));
  }

  private _onAfterHide() {
    this._dialog.open = false;
    this._enter.set(false);
    if (this._resolvedExit === null) {
      this.dispatchEvent(new CustomEvent("cancel", { bubbles: true, composed: true }));
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-yaml-validation-dialog": ESPHomeYamlValidationDialog;
  }
}
