/**
 * Light-effect editor pane.
 *
 * Used when the editor's target is a light's ``effects:`` list — the
 * UX maps to one ``light_effect`` per location, so the panel just
 * picks the effect kind and renders the effect's parameter form via
 * ``<esphome-config-entry-form>``. The pickable effect kinds are
 * filtered against the target light's ``component_id`` (so
 * ``addressable_lambda`` only appears for addressable lights).
 */
import { consume } from "@lit/context";
import { html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import type {
  AutomationLocation,
  AvailableComponentInstance,
  BoardCatalogEntry,
  LightEffect,
} from "../../../api/types.js";
import type { LocalizeFunc } from "../../../common/localize.js";
import { localizeContext } from "../../../context/index.js";
import { espHomeStyles } from "../../../styles/shared.js";
import { inputStyles } from "../../../styles/inputs.js";
import { automationEditorStyles } from "./automation-editor.styles.js";
import { applyParamChange } from "./serialise.js";
import "../config-entry-form.js";
import type { ConfigEntryValueChange } from "../config-entry-form.js";

import "@home-assistant/webawesome/dist/components/option/option.js";
import "@home-assistant/webawesome/dist/components/select/select.js";

@customElement("esphome-automation-effects-editor")
export class ESPHomeAutomationEffectsEditor extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  /** The target location — we only render anything when its kind
   *  is ``light_effect``. */
  @property({ attribute: false })
  target: AutomationLocation | null = null;

  /** The current effect id (stored in ``AutomationTree.trigger_id``
   *  for light_effect locations) + its params (in trigger_params). */
  @property() effectId: string | null = null;

  @property({ attribute: false })
  effectParams: Record<string, unknown> = {};

  @property({ attribute: false })
  effects: LightEffect[] = [];

  @property({ attribute: false })
  devices: AvailableComponentInstance[] = [];

  @property({ attribute: false })
  board: BoardCatalogEntry | null = null;

  @property() yaml = "";

  @property({ type: Boolean })
  disabled = false;

  static styles = [espHomeStyles, inputStyles, automationEditorStyles];

  protected render() {
    if (this.target?.kind !== "light_effect") return nothing;
    const compatible = this._compatibleEffects();
    const def = compatible.find((e) => e.id === this.effectId);
    return html`
      <div class="ae-section">
        <label class="ae-section-label" id="effect-label"
          >${this._localize("device.automation_light_effect")}</label
        >
        <wa-select
          aria-labelledby="effect-label"
          ?disabled=${this.disabled}
          @change=${this._onEffectChange}
        >
          ${compatible.map(
            (e) => html`<wa-option value=${e.id} ?selected=${e.id === this.effectId}
              >${e.name}</wa-option
            >`,
          )}
        </wa-select>
        ${def && def.config_entries.length > 0
          ? html`<esphome-config-entry-form
              .entries=${def.config_entries}
              .values=${this.effectParams}
              .board=${this.board}
              .yaml=${this.yaml}
              ?disabled=${this.disabled}
              @value-change=${this._onParamChange}
            ></esphome-config-entry-form>`
          : nothing}
      </div>
    `;
  }

  private _compatibleEffects(): LightEffect[] {
    if (this.target?.kind !== "light_effect") return [];
    const componentId = this.target.component_id;
    const device = this.devices.find((d) => d.id === componentId);
    if (!device) return this.effects;
    return this.effects.filter(
      (e) =>
        e.applies_to.length === 0 ||
        e.applies_to.includes(device.component_id) ||
        e.applies_to.includes("light"),
    );
  }

  private _onEffectChange = (e: Event) => {
    const id = (e.target as HTMLSelectElement).value;
    this.dispatchEvent(
      new CustomEvent("effect-change", {
        detail: { effectId: id, params: {} },
        bubbles: true,
        composed: true,
      }),
    );
  };

  private _onParamChange = (e: CustomEvent<ConfigEntryValueChange>) => {
    e.stopPropagation();
    const next = applyParamChange(
      this.effectParams,
      e.detail.path,
      e.detail.value,
    );
    this.dispatchEvent(
      new CustomEvent("effect-params-change", {
        detail: { params: next },
        bubbles: true,
        composed: true,
      }),
    );
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-automation-effects-editor": ESPHomeAutomationEffectsEditor;
  }
}
