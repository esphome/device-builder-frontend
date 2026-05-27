/**
 * Step 2 of the automation editor: pick the trigger for the chosen
 * target and edit its parameters.
 *
 * The trigger picker filters the catalog down to triggers compatible
 * with the current target:
 *
 * - ``device_on`` → only device-level triggers.
 * - ``component_on`` → triggers whose ``applies_to`` lists the
 *   resolved component's domain/platform.
 * - ``interval`` / ``script`` / ``light_effect`` → trigger picker is
 *   not shown (those blocks don't carry a trigger key in YAML — the
 *   block kind is implied by the location).
 *
 * Parameter form is delegated to ``<esphome-config-entry-form>`` so
 * id pickers / pin pickers / depends-on cascades / the literal-↔-λ
 * toggle introduced in section A all work for free.
 */
import { consume } from "@lit/context";
import { html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import type {
  AutomationLocation,
  AutomationTrigger,
  AvailableComponentInstance,
  BoardCatalogEntry,
} from "../../../api/types.js";
import type { LocalizeFunc } from "../../../common/localize.js";
import { localizeContext } from "../../../context/index.js";
import { espHomeStyles } from "../../../styles/shared.js";
import { inputStyles } from "../../../styles/inputs.js";
import { renderMarkdown } from "../../../util/markdown.js";
import { automationEditorStyles } from "./automation-editor.styles.js";
import { applyParamChange } from "./serialise.js";
import "../config-entry-form.js";
import type { ConfigEntryValueChange } from "../config-entry-form.js";

import "@home-assistant/webawesome/dist/components/option/option.js";
import "@home-assistant/webawesome/dist/components/select/select.js";

@customElement("esphome-automation-trigger-picker")
export class ESPHomeAutomationTriggerPicker extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @property({ attribute: false })
  target: AutomationLocation | null = null;

  @property({ attribute: false })
  triggers: AutomationTrigger[] = [];

  @property({ attribute: false })
  devices: AvailableComponentInstance[] = [];

  @property() triggerId: string | null = null;

  @property({ attribute: false })
  triggerParams: Record<string, unknown> = {};

  @property({ attribute: false })
  board: BoardCatalogEntry | null = null;

  @property() yaml = "";

  @property({ type: Boolean })
  disabled = false;

  static styles = [espHomeStyles, inputStyles, automationEditorStyles];

  protected render() {
    if (!this.target) {
      return html`<p class="ae-empty">
        ${this._localize("device.automation_target_placeholder")}
      </p>`;
    }
    // Top-level / nested callable blocks (interval, script,
    // api_action, light_effect) carry no trigger key — the writer
    // infers them from the location.
    if (
      this.target.kind === "interval" ||
      this.target.kind === "script" ||
      this.target.kind === "api_action" ||
      this.target.kind === "light_effect"
    ) {
      return nothing;
    }
    const filtered = this._filteredTriggers();
    const active = filtered.find((t) => t.id === this.triggerId);
    const componentId =
      this.target.kind === "component_on" ? this.target.component_id : null;
    const boundDevice = componentId
      ? (this.devices.find((d) => d.id === componentId) ?? null)
      : null;
    return html`
      <div class="ae-section">
        <label class="ae-section-label" id="trigger-label"
          >${this._localize("device.automation_trigger")}</label
        >
        ${boundDevice
          ? html`<p class="ae-section-desc">
              ${this._localize("device.automation_trigger_on_component", {
                component: boundDevice.name ?? boundDevice.id,
                domain: boundDevice.component_id,
              })}
            </p>`
          : nothing}
        ${filtered.length === 0
          ? html`<p class="ae-empty" role="status">
              ${this._localize("device.automation_trigger_none_available")}
            </p>`
          : html`<wa-select
              aria-labelledby="trigger-label"
              value=${this.triggerId ?? ""}
              ?disabled=${this.disabled}
              @change=${this._onTriggerChange}
            >
              ${filtered.map(
                (t) =>
                  html`<wa-option value=${t.id} ?selected=${t.id === this.triggerId}
                    >${t.name}</wa-option
                  >`
              )}
            </wa-select>`}
        ${active?.description
          ? html`<p class="ae-section-desc">${renderMarkdown(active.description)}</p>`
          : nothing}
        ${active && active.config_entries.length > 0
          ? html`<esphome-config-entry-form
              .entries=${active.config_entries}
              .values=${this.triggerParams}
              .board=${this.board}
              .yaml=${this.yaml}
              ?disabled=${this.disabled}
              @value-change=${this._onParamChange}
            ></esphome-config-entry-form>`
          : nothing}
      </div>
    `;
  }

  private _filteredTriggers(): AutomationTrigger[] {
    if (!this.target) return [];
    if (this.target.kind === "device_on") {
      return this.triggers.filter((t) => t.is_device_level);
    }
    if (this.target.kind === "component_on") {
      const componentId = this.target.component_id;
      const device = this.devices.find((d) => d.id === componentId);
      if (!device) return [];
      // Match either the bare domain (``binary_sensor``) or the
      // domain.platform tuple (``binary_sensor.gpio``); the backend
      // emits triggers under both shapes and the catalog dictates
      // which one wins.
      const [domain] = device.component_id.split(".");
      return this.triggers.filter(
        (t) =>
          !t.is_device_level &&
          (t.applies_to.includes(device.component_id) || t.applies_to.includes(domain))
      );
    }
    return [];
  }

  private _onTriggerChange = (e: Event) => {
    const id = (e.target as HTMLSelectElement).value;
    this.dispatchEvent(
      new CustomEvent("trigger-change", {
        detail: { triggerId: id, params: {} },
        bubbles: true,
        composed: true,
      })
    );
  };

  private _onParamChange = (e: CustomEvent<ConfigEntryValueChange>) => {
    e.stopPropagation();
    const next = applyParamChange(this.triggerParams, e.detail.path, e.detail.value);
    this.dispatchEvent(
      new CustomEvent("trigger-params-change", {
        detail: { params: next },
        bubbles: true,
        composed: true,
      })
    );
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-automation-trigger-picker": ESPHomeAutomationTriggerPicker;
  }
}
