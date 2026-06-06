import { consume } from "@lit/context";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { localizeContext } from "../../context/index.js";
import { dialogActionButtonStyles } from "../../styles/dialog-action-buttons.js";
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

  /** The device's own config file; overwriting it keeps the device's
   *  labels / comment / board, so its row is flagged distinctly. */
  @property({ type: String }) mainConfig = "";

  /** Paths the user has marked for overwrite. */
  @state()
  private _overwrite = new Set<string>();

  static styles = [
    espHomeStyles,
    dialogActionButtonStyles,
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

      .badge {
        margin-left: var(--wa-space-xs);
        font-family: var(--wa-font-family-body, sans-serif);
        font-size: var(--wa-font-size-2xs, 0.7rem);
        color: var(--wa-color-text-quiet);
        white-space: nowrap;
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
    `,
  ];

  protected render() {
    return html`
      <p class="intro">${this._localize("wizard.import_bundle_conflicts_desc")}</p>

      <div class="files">
        ${this.conflicts.map((path, i) => {
          // Index-based id: a tar path can contain spaces or other
          // characters that aren't valid in an HTML id, which would
          // break the label-to-input association.
          const id = `cf-${i}`;
          const overwrite = this._overwrite.has(path);
          const isMain = path === this.mainConfig;
          return html`
            <div class="file-row">
              <input
                id=${id}
                type="checkbox"
                .checked=${overwrite}
                @change=${() => this._toggle(path)}
              />
              <label for=${id}>
                ${path}
                ${isMain
                  ? html`<span class="badge"
                      >${this._localize("wizard.import_bundle_main_config")}</span
                    >`
                  : nothing}
              </label>
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
        <button class="btn btn--cancel" @click=${this._cancel}>
          ${this._localize("wizard.cancel")}
        </button>
        <button class="btn btn--primary" @click=${this._confirm}>
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
