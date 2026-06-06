import { consume } from "@lit/context";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { localizeContext } from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";

/** Lets the user choose which bundle files overwrite the ones already on
 *  disk. Unchecked files are kept; secrets.yaml is always merged and is
 *  never listed here. Emits 'resolve-conflicts' with the chosen paths. */
@customElement("esphome-wizard-step-resolve-conflicts")
export class ESPHomeWizardStepResolveConflicts extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  /** Bundle files that already exist on disk. */
  @property({ type: Array }) conflicts: string[] = [];

  /** Whether the bundle ships secrets (merged, not overwritten). */
  @property({ type: Boolean }) hasSecrets = false;

  /** Paths the user has marked for overwrite. */
  @state()
  private _overwrite = new Set<string>();

  static styles = [
    espHomeStyles,
    css`
      :host {
        display: block;
      }

      p.intro {
        margin: 0 0 var(--wa-space-m);
        color: var(--wa-color-text-quiet);
        font-size: var(--wa-font-size-s);
      }

      .files {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-xs);
        margin-bottom: var(--wa-space-l);
        max-height: 280px;
        overflow-y: auto;
      }

      .file-row {
        display: flex;
        align-items: center;
        gap: var(--wa-space-s);
        padding: var(--wa-space-xs) var(--wa-space-s);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        border-radius: var(--wa-border-radius-m);
      }

      .file-row label {
        flex: 1;
        font-family: var(--wa-font-family-code, monospace);
        font-size: var(--wa-font-size-s);
        color: var(--wa-color-text-normal);
        word-break: break-all;
        cursor: pointer;
      }

      .state {
        font-size: var(--wa-font-size-xs);
        color: var(--wa-color-text-quiet);
      }

      .secrets-note {
        margin: 0 0 var(--wa-space-l);
        font-size: var(--wa-font-size-xs);
        color: var(--wa-color-text-quiet);
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
      }

      .btn-cancel {
        background: var(--wa-color-surface-raised);
        border-color: var(--wa-color-surface-border);
        color: var(--wa-color-text-normal);
      }

      .btn-next {
        background: var(--esphome-primary);
        color: var(--esphome-on-primary);
      }
    `,
  ];

  protected render() {
    return html`
      <p class="intro">${this._localize("wizard.import_bundle_conflicts_desc")}</p>

      <div class="files">
        ${this.conflicts.map((path) => {
          const overwrite = this._overwrite.has(path);
          return html`
            <div class="file-row">
              <input
                id=${`cf-${path}`}
                type="checkbox"
                .checked=${overwrite}
                @change=${() => this._toggle(path)}
              />
              <label for=${`cf-${path}`}>${path}</label>
              <span class="state">
                ${overwrite
                  ? this._localize("wizard.import_bundle_overwrite")
                  : this._localize("wizard.import_bundle_keep")}
              </span>
            </div>
          `;
        })}
      </div>

      ${this.hasSecrets
        ? html`<p class="secrets-note">
            ${this._localize("wizard.import_bundle_secrets_note")}
          </p>`
        : nothing}

      <div class="actions">
        <button class="btn btn-cancel" @click=${this._cancel}>
          ${this._localize("wizard.cancel")}
        </button>
        <button class="btn btn-next" @click=${this._confirm}>
          ${this._localize("wizard.import_bundle_button")}
        </button>
      </div>
    `;
  }

  private _toggle(path: string) {
    const next = new Set(this._overwrite);
    if (next.has(path)) {
      next.delete(path);
    } else {
      next.add(path);
    }
    this._overwrite = next;
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
      new CustomEvent("resolve-conflicts", {
        detail: { overwrite: [...this._overwrite] },
        bubbles: true,
        composed: true,
      })
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-wizard-step-resolve-conflicts": ESPHomeWizardStepResolveConflicts;
  }
}
