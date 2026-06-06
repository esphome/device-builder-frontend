/**
 * Structured (form) side of the split secrets editor. The ``value`` YAML
 * is the source of truth; each edit splices one line via
 * ``util/secrets-entries`` and emits ``yaml-change`` like the YAML editor.
 */
import { consume } from "@lit/context";
import { mdiAlertCircleOutline, mdiClose, mdiPlus } from "@mdi/js";
import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { localizeContext } from "../../context/index.js";
import { inputStyles } from "../../styles/inputs.js";
import { espHomeStyles } from "../../styles/shared.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import {
  addSecret,
  isValidSecretKey,
  parseSecretsEntries,
  removeSecret,
  renameSecretKey,
  setSecretValue,
  type SecretEntry,
} from "../../util/secrets-entries.js";
import { secretsStructuredEditorStyles } from "./secrets-structured-editor.styles.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({
  "alert-circle-outline": mdiAlertCircleOutline,
  close: mdiClose,
  plus: mdiPlus,
});

@customElement("esphome-secrets-structured-editor")
export class ESPHomeSecretsStructuredEditor extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  /** The secrets.yaml text — the single source of truth. */
  @property()
  value = "";

  /** Show real values; otherwise value inputs render as password dots. */
  @property({ type: Boolean })
  revealSensitive = false;

  /** Inline "invalid / duplicate key" message for the row being renamed. */
  @state()
  private _keyError: { line: number; message: string } | null = null;

  /** Set after Add so ``updated`` can focus the freshly-minted key input. */
  private _focusKeyLine: number | null = null;

  static styles = [espHomeStyles, inputStyles, secretsStructuredEditorStyles];

  protected render() {
    const entries = parseSecretsEntries(this.value);
    return html`
      ${entries.length === 0
        ? html`<div class="empty" role="status">${this._localize("secrets.empty")}</div>`
        : html`<div class="rows">
            ${entries.map((entry) => this._renderRow(entry, entries))}
          </div>`}
      <div class="add-row">
        <button type="button" class="add-btn" @click=${() => this._add(entries)}>
          <wa-icon library="mdi" name="plus"></wa-icon>
          ${this._localize("secrets.add_secret")}
        </button>
      </div>
    `;
  }

  private _renderRow(entry: SecretEntry, entries: SecretEntry[]) {
    const keyInvalid = this._keyError?.line === entry.line;
    if (!entry.editable) {
      return html`<div class="row row--advanced">
        <input
          type="text"
          .value=${entry.key}
          readonly
          aria-label=${this._localize("secrets.key_placeholder")}
        />
        <span class="advanced-badge">
          <wa-icon library="mdi" name="alert-circle-outline"></wa-icon>
          ${this._localize("secrets.advanced_badge")}
        </span>
        <span></span>
      </div>`;
    }
    return html`<div class="row">
        <input
          type="text"
          class="key-input ${keyInvalid ? "invalid" : ""}"
          data-line=${entry.line}
          .value=${live(entry.key)}
          autocomplete="off"
          spellcheck="false"
          placeholder=${this._localize("secrets.key_placeholder")}
          aria-label=${this._localize("secrets.key_placeholder")}
          aria-invalid=${keyInvalid ? "true" : "false"}
          @change=${(e: Event) =>
            this._onKeyChange(entry, entries, e.currentTarget as HTMLInputElement)}
        />
        <input
          type=${this.revealSensitive ? "text" : "password"}
          .value=${live(entry.value)}
          autocomplete="off"
          spellcheck="false"
          placeholder=${this._localize("secrets.value_placeholder")}
          aria-label=${this._localize("secrets.value_placeholder")}
          @input=${(e: Event) =>
            this._emit(
              setSecretValue(
                this.value,
                entry.line,
                (e.currentTarget as HTMLInputElement).value
              )
            )}
        />
        <button
          type="button"
          class="icon-btn"
          title=${this._localize("secrets.remove_secret")}
          aria-label=${this._localize("secrets.remove_secret")}
          @click=${() => this._emit(removeSecret(this.value, entry.line))}
        >
          <wa-icon library="mdi" name="close"></wa-icon>
        </button>
      </div>
      ${keyInvalid
        ? html`<div class="key-error">${this._keyError?.message}</div>`
        : nothing}`;
  }

  private _onKeyChange(
    entry: SecretEntry,
    entries: SecretEntry[],
    input: HTMLInputElement
  ) {
    const newKey = input.value.trim();
    if (newKey === entry.key) {
      this._keyError = null;
      return;
    }
    if (!isValidSecretKey(newKey)) {
      this._keyError = {
        line: entry.line,
        message: this._localize("secrets.invalid_key"),
      };
      input.value = entry.key;
      return;
    }
    if (entries.some((other) => other.line !== entry.line && other.key === newKey)) {
      this._keyError = {
        line: entry.line,
        message: this._localize("secrets.duplicate_key"),
      };
      input.value = entry.key;
      return;
    }
    this._keyError = null;
    this._emit(renameSecretKey(this.value, entry.line, newKey));
  }

  private _add(entries: SecretEntry[]) {
    const taken = new Set(entries.map((e) => e.key));
    let key = "new_secret";
    for (let n = 2; taken.has(key); n++) key = `new_secret_${n}`;
    const next = addSecret(this.value, key, "");
    // The appended entry is the last top-level key line; focus it so the
    // user can rename the placeholder immediately.
    const added = parseSecretsEntries(next);
    this._focusKeyLine = added.length > 0 ? added[added.length - 1].line : null;
    this._keyError = null;
    this._emit(next);
  }

  protected updated() {
    if (this._focusKeyLine === null) return;
    const line = this._focusKeyLine;
    this._focusKeyLine = null;
    const input = this.renderRoot.querySelector<HTMLInputElement>(
      `input.key-input[data-line="${line}"]`
    );
    input?.focus();
    input?.select();
  }

  // A splice helper returns null when its target line no longer matches
  // (a stale index from a concurrent edit); skip rather than echo the
  // unchanged buffer as a successful change.
  private _emit(value: string | null) {
    if (value === null) return;
    this.value = value;
    this.dispatchEvent(
      new CustomEvent("yaml-change", { detail: { value }, bubbles: true, composed: true })
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-secrets-structured-editor": ESPHomeSecretsStructuredEditor;
  }
}
