/**
 * Script panel — declared parameters + mode picker.
 *
 * Rendered only when the editor's target is ``script``. Lets the
 * user add / remove parameter declarations (``parameters: hour:
 * int``) and pick the run mode (``single`` / ``restart`` / ``queued``
 * / ``parallel``). The parameter declarations themselves live in
 * ``AutomationTree.trigger_params``: ``parameters`` and ``mode``
 * sub-keys, which the writer hoists back into the YAML.
 */
import { consume } from "@lit/context";
import { html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { mdiClose, mdiPlus } from "@mdi/js";

import type { AutomationLocation } from "../../../api/types.js";
import type { LocalizeFunc } from "../../../common/localize.js";
import { localizeContext } from "../../../context/index.js";
import { espHomeStyles } from "../../../styles/shared.js";
import { inputStyles } from "../../../styles/inputs.js";
import { registerMdiIcons } from "../../../util/register-icons.js";
import { automationEditorStyles } from "./automation-editor.styles.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/option/option.js";
import "@home-assistant/webawesome/dist/components/select/select.js";

registerMdiIcons({ close: mdiClose, plus: mdiPlus });

interface ParameterDecl {
  name: string;
  type: string;
}

const RUN_MODES = ["single", "restart", "queued", "parallel"] as const;

const PARAM_TYPES = ["int", "float", "bool", "string"] as const;

@customElement("esphome-automation-script-params")
export class ESPHomeAutomationScriptParams extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @property({ attribute: false })
  target: AutomationLocation | null = null;

  /** Trigger params storage — we read/write ``parameters`` and
   *  ``mode`` sub-keys here. */
  @property({ attribute: false })
  triggerParams: Record<string, unknown> = {};

  @property({ type: Boolean })
  disabled = false;

  static styles = [espHomeStyles, inputStyles, automationEditorStyles];

  protected render() {
    if (this.target?.kind !== "script") return nothing;
    const params = this._readParams();
    const mode = String(this.triggerParams.mode ?? "single");
    return html`
      <div class="ae-section">
        <label class="ae-section-label">
          ${this._localize("device.automation_script_mode")}
        </label>
        <wa-select
          ?disabled=${this.disabled}
          @change=${(e: Event) =>
            this._emit({
              ...this.triggerParams,
              mode: (e.target as HTMLSelectElement).value,
            })}
        >
          ${RUN_MODES.map(
            (m) => html`<wa-option value=${m} ?selected=${m === mode}
              >${m}</wa-option
            >`,
          )}
        </wa-select>
        <label class="ae-section-label">
          ${this._localize("device.automation_script_parameters")}
        </label>
        ${params.length === 0
          ? html`<p class="ae-empty">
              ${this._localize("device.automation_script_parameters")}
            </p>`
          : params.map((p, idx) => this._renderParam(p, idx))}
        <button
          type="button"
          class="ae-add"
          ?disabled=${this.disabled}
          @click=${this._addParam}
        >
          <wa-icon library="mdi" name="plus"></wa-icon>
          ${this._localize("device.automation_script_parameters")}
        </button>
      </div>
    `;
  }

  private _renderParam(p: ParameterDecl, idx: number) {
    return html`<div class="ae-row">
      <div class="ae-row-body">
        <input
          type="text"
          ?disabled=${this.disabled}
          placeholder="name"
          .value=${p.name}
          @input=${(e: Event) =>
            this._updateParam(idx, {
              ...p,
              name: (e.target as HTMLInputElement).value,
            })}
        />
        <wa-select
          ?disabled=${this.disabled}
          @change=${(e: Event) =>
            this._updateParam(idx, {
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
      </div>
      <div class="ae-row-controls">
        <button
          type="button"
          ?disabled=${this.disabled}
          aria-label=${this._localize("device.automation_remove")}
          @click=${() => this._removeParam(idx)}
        >
          <wa-icon library="mdi" name="close"></wa-icon>
        </button>
      </div>
    </div>`;
  }

  private _readParams(): ParameterDecl[] {
    const raw = this.triggerParams.parameters;
    if (!raw || typeof raw !== "object") return [];
    return Object.entries(raw as Record<string, unknown>).map(([name, type]) => ({
      name,
      type: String(type ?? "string"),
    }));
  }

  private _writeParams(list: ParameterDecl[]) {
    const dict: Record<string, string> = {};
    for (const { name, type } of list) {
      if (name) dict[name] = type;
    }
    this._emit({ ...this.triggerParams, parameters: dict });
  }

  private _addParam = () => {
    this._writeParams([...this._readParams(), { name: "", type: "int" }]);
  };

  private _updateParam(idx: number, value: ParameterDecl) {
    const list = this._readParams();
    list[idx] = value;
    this._writeParams(list);
  }

  private _removeParam(idx: number) {
    const list = this._readParams();
    list.splice(idx, 1);
    this._writeParams(list);
  }

  private _emit(triggerParams: Record<string, unknown>) {
    this.dispatchEvent(
      new CustomEvent("script-params-change", {
        detail: { triggerParams },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-automation-script-params": ESPHomeAutomationScriptParams;
  }
}
