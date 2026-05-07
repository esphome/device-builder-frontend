import { consume } from "@lit/context";
import { mdiAlertOutline } from "@mdi/js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { LocalizeFunc } from "../common/localize.js";
import { localizeContext } from "../context/index.js";
import { espHomeStyles } from "../styles/shared.js";
import { registerMdiIcons } from "../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/dialog/dialog.js";
import "@home-assistant/webawesome/dist/components/icon/icon.js";

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

  @query("wa-dialog")
  private _dialog!: HTMLElement & { open: boolean };

  static styles = [
    espHomeStyles,
    css`
      wa-dialog {
        --width: 480px;
      }

      wa-dialog::part(header) {
        padding: var(--wa-space-l) var(--wa-space-l) var(--wa-space-s);
      }

      wa-dialog::part(title) {
        font-size: var(--wa-font-size-m);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-normal);
      }

      wa-dialog::part(close-button__base) {
        background: transparent;
        border: none;
        box-shadow: none;
      }

      wa-dialog::part(body) {
        padding: 0 var(--wa-space-l);
      }

      wa-dialog::part(footer) {
        display: none;
      }

      .body {
        display: flex;
        align-items: flex-start;
        gap: var(--wa-space-m);
        padding-bottom: var(--wa-space-m);
      }

      .icon-wrap {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 40px;
        height: 40px;
        border-radius: 50%;
        flex-shrink: 0;
        background: color-mix(in srgb, var(--esphome-error), transparent 88%);
        color: var(--esphome-error);
      }

      .icon-wrap wa-icon {
        font-size: 22px;
      }

      .text {
        flex: 1;
        min-width: 0;
        font-size: var(--wa-font-size-s);
        color: var(--wa-color-text-quiet);
        line-height: 1.5;
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

      .actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--wa-space-s);
        flex-wrap: wrap;
        padding: var(--wa-space-m) var(--wa-space-l) var(--wa-space-l);
      }

      .btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 8px 18px;
        border-radius: var(--wa-border-radius-m);
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
        font-family: inherit;
        cursor: pointer;
        border: none;
        transition: background 0.12s;
      }

      .btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .btn--cancel {
        background: var(--wa-color-surface-lowered);
        color: var(--wa-color-text-normal);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
      }

      .btn--cancel:hover {
        background: var(--wa-color-surface-border);
      }

      .btn--goto {
        background: var(--esphome-primary);
        color: var(--esphome-on-primary);
      }

      .btn--goto:hover:not(:disabled) {
        background: color-mix(in srgb, var(--esphome-primary), black 10%);
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

  open() {
    this._resolvedExit = null;
    this._dialog.open = true;
  }

  close() {
    this._dialog.open = false;
  }

  protected render() {
    const messageKey =
      this.errorCount === 1
        ? "device.yaml_invalid_message_singular"
        : "device.yaml_invalid_message_plural";
    const message = this._localize(messageKey, {
      count: String(this.errorCount),
    });
    const canGoToError = this.firstErrorLine > 0;
    return html`
      <wa-dialog
        label=${this._localize("device.yaml_invalid_title")}
        light-dismiss
        @wa-after-hide=${this._onAfterHide}
      >
        <div class="body">
          <div class="icon-wrap">
            <wa-icon library="mdi" name="alert-outline"></wa-icon>
          </div>
          <div class="text">
            ${message}
            ${this.firstErrorMessage
              ? html`<div class="first-error">${this.firstErrorMessage}</div>`
              : nothing}
          </div>
        </div>
        <div class="actions">
          <button class="btn btn--cancel" @click=${this.close}>
            ${this._localize("layout.cancel")}
          </button>
          <button
            class="btn btn--goto"
            ?disabled=${!canGoToError}
            @click=${this._goto}
          >
            ${this._localize("device.yaml_invalid_go_to_error")}
          </button>
          <button class="btn btn--save-anyway" @click=${this._saveAnyway}>
            ${this._localize("device.yaml_invalid_save_anyway")}
          </button>
        </div>
      </wa-dialog>
    `;
  }

  private _goto() {
    this._resolvedExit = "goto";
    this.close();
    this.dispatchEvent(
      new CustomEvent("goto", {
        detail: { line: this.firstErrorLine, col: this.firstErrorCol },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _saveAnyway() {
    this._resolvedExit = "save-anyway";
    this.close();
    this.dispatchEvent(
      new CustomEvent("save-anyway", { bubbles: true, composed: true }),
    );
  }

  private _onAfterHide() {
    if (this._resolvedExit === null) {
      this.dispatchEvent(
        new CustomEvent("cancel", { bubbles: true, composed: true }),
      );
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-yaml-validation-dialog": ESPHomeYamlValidationDialog;
  }
}
