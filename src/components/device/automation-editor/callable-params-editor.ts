/**
 * Typed-parameter list editor shared by ``<esphome-script-editor>``
 * and ``<esphome-api-action-editor>``.
 *
 * Both surfaces declare a ``{name: type}`` map on their wire
 * (``script:`` calls it ``parameters:``; ``api.actions:`` calls it
 * ``variables:``). The shape is identical, so the editor lives here
 * once and the host surface only labels it and routes the resulting
 * map into the right ``trigger_params`` key.
 *
 * Empty-name rows persist locally until the user fills them in — the
 * wire dict is keyed by name and can't represent unnamed entries, so
 * unnamed locals stay in component state until the user finishes
 * typing.
 */
import { consume } from "@lit/context";
import { html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { mdiClose, mdiPlus } from "@mdi/js";

import type { LocalizeFunc } from "../../../common/localize.js";
import { localizeContext } from "../../../context/index.js";
import { espHomeStyles } from "../../../styles/shared.js";
import { inputStyles } from "../../../styles/inputs.js";
import { registerMdiIcons } from "../../../util/register-icons.js";
import { renderMarkdown } from "../../../util/markdown.js";
import { automationEditorStyles } from "./automation-editor.styles.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/option/option.js";
import "@home-assistant/webawesome/dist/components/select/select.js";

registerMdiIcons({ close: mdiClose, plus: mdiPlus });

/** Parameter types ESPHome's ``script: parameters:`` and
 *  ``api.actions: variables:`` blocks accept. The backend validates
 *  these on save; we pin the user to the same set here. */
const PARAM_TYPES = ["int", "float", "bool", "string"] as const;

interface ParameterDecl {
  name: string;
  type: string;
}

@customElement("esphome-callable-params-editor")
export class ESPHomeCallableParamsEditor extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  /** ``{name: type}`` wire map — the host's ``trigger_params``
   *  key (``parameters`` for scripts, ``variables`` for
   *  api-actions). */
  @property({ attribute: false })
  value: Record<string, string> = {};

  /** Disable inputs (e.g. while a delete is in flight). */
  @property({ type: Boolean })
  disabled = false;

  /** Localized "Parameters" / "Variables" field label. */
  @property() fieldLabel = "";

  /** Localized markdown description rendered under the label. */
  @property() description = "";

  /** Localized "Add parameter" / "Add variable" button text. */
  @property() addLabel = "";

  /** Localized text input placeholder for the name column. */
  @property() namePlaceholder = "";

  /**
   * Working list mirroring ``value`` plus any in-progress unnamed
   * rows. Projected back to the wire map on each change; unnamed
   * rows stay local until they get a name.
   */
  @state() private _params: ParameterDecl[] = [];

  static styles = [espHomeStyles, inputStyles, automationEditorStyles];

  protected updated(changed: Map<string, unknown>) {
    if (!changed.has("value")) return;
    // Sync from outside (hydrate / parent re-render). Don't disturb
    // local empty-name rows when the wire matches what we already
    // have for named entries — the user is mid-edit on an unnamed
    // row and we shouldn't drop it.
    const fromWire = this._readFromWire();
    const localNamed = this._params.filter((p) => p.name);
    const matches =
      localNamed.length === fromWire.length &&
      localNamed.every(
        (p, i) => p.name === fromWire[i].name && p.type === fromWire[i].type,
      );
    if (!matches) this._params = fromWire;
  }

  protected render() {
    return html`<div class="field">
      ${this.fieldLabel
        ? html`<label class="field-label">${this.fieldLabel}</label>`
        : nothing}
      ${this.description
        ? html`<p class="field-description">
            ${renderMarkdown(this.description)}
          </p>`
        : nothing}
      ${this._params.length === 0
        ? nothing
        : html`<div class="script-params-list">
            ${this._params.map((p, idx) => this._renderRow(p, idx))}
          </div>`}
      <button
        type="button"
        class="script-param-add"
        ?disabled=${this.disabled}
        @click=${this._addRow}
      >
        <wa-icon library="mdi" name="plus"></wa-icon>
        ${this.addLabel}
      </button>
    </div>`;
  }

  private _renderRow(p: ParameterDecl, idx: number) {
    return html`<div class="script-param-row">
      <input
        type="text"
        ?disabled=${this.disabled}
        placeholder=${this.namePlaceholder}
        .value=${p.name}
        @input=${(e: Event) =>
          this._updateRow(idx, {
            ...p,
            name: (e.target as HTMLInputElement).value,
          })}
      />
      <wa-select
        value=${p.type}
        ?disabled=${this.disabled}
        @change=${(e: Event) =>
          this._updateRow(idx, {
            ...p,
            type: (e.target as HTMLSelectElement).value,
          })}
      >
        ${PARAM_TYPES.map(
          (t) => html`<wa-option value=${t} ?selected=${t === p.type}
            >${t}</wa-option
          >`,
        )}
      </wa-select>
      <button
        type="button"
        class="script-param-remove"
        ?disabled=${this.disabled}
        aria-label=${this._localize("device.automation_remove")}
        @click=${() => this._removeRow(idx)}
      >
        <wa-icon library="mdi" name="close"></wa-icon>
      </button>
    </div>`;
  }

  private _readFromWire(): ParameterDecl[] {
    if (!this.value || typeof this.value !== "object") return [];
    return Object.entries(this.value).map(([name, type]) => ({
      name,
      type: String(type ?? "string"),
    }));
  }

  private _emit(list: ParameterDecl[]) {
    this._params = list;
    const dict: Record<string, string> = {};
    for (const { name, type } of list) {
      if (name) dict[name] = type;
    }
    this.dispatchEvent(
      new CustomEvent<{ value: Record<string, string> }>("value-change", {
        detail: { value: dict },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _addRow = () => {
    this._emit([...this._params, { name: "", type: "int" }]);
  };

  private _updateRow(idx: number, value: ParameterDecl) {
    const list = this._params.slice();
    list[idx] = value;
    this._emit(list);
  }

  private _removeRow(idx: number) {
    const list = this._params.slice();
    list.splice(idx, 1);
    this._emit(list);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-callable-params-editor": ESPHomeCallableParamsEditor;
  }
}
