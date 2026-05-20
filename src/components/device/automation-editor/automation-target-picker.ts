/**
 * Step 1 of the automation editor: pick the automation's target.
 *
 * Five target kinds, matching the ``AutomationLocation`` discriminator
 * the backend writer consumes:
 *
 * - ``device_on`` — the device itself (``on_boot`` / ``on_loop`` /
 *   ``on_shutdown`` under ``esphome:``).
 * - ``component_on`` — an inline ``on_*:`` handler on a configured
 *   component instance (a specific binary_sensor, switch, …).
 * - ``interval`` — a top-level ``interval:`` block.
 * - ``script`` — a top-level ``script:`` block.
 * - ``light_effect`` — a user-defined effect inside a light's
 *   ``effects:`` list.
 *
 * ``api_action`` is intentionally absent from this picker. Those
 * entries live nested under the api component (``api: actions:``)
 * and are managed inline from the api section editor — the
 * "create a thing that reacts to a trigger" framing doesn't apply.
 * The structured editor still HANDLES a pre-existing
 * ``ApiActionLocation`` (so a navigator click on a parsed api
 * action still routes correctly).
 *
 * The picker is presentational: parent owns the selected
 * ``AutomationLocation`` and the list of available component
 * instances (from ``getAvailableAutomations``).
 */
import { consume } from "@lit/context";
import { html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import type {
  AutomationLocation,
  AvailableComponentInstance,
  AvailableScript,
} from "../../../api/types.js";
import type { LocalizeFunc } from "../../../common/localize.js";
import { localizeContext } from "../../../context/index.js";
import { espHomeStyles } from "../../../styles/shared.js";
import { inputStyles } from "../../../styles/inputs.js";
import { automationEditorStyles } from "./automation-editor.styles.js";

import "@home-assistant/webawesome/dist/components/option/option.js";
import "@home-assistant/webawesome/dist/components/select/select.js";

type TargetKind = AutomationLocation["kind"];

/**
 * Kinds the user can pick when creating an automation from the
 * automation dialog. ``light_effect`` is intentionally absent —
 * effects belong to a light's own config and live under the light
 * component's section editor, not the automations group. The
 * automation editor still HANDLES a pre-existing
 * ``LightEffectLocation`` (so a navigator click on a parsed effect
 * automation still works) but the picker doesn't let the user
 * create one through this surface.
 */
const ORDER: readonly TargetKind[] = [
  "device_on",
  "component_on",
  "interval",
  "script",
] as const;

@customElement("esphome-automation-target-picker")
export class ESPHomeAutomationTargetPicker extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  /** Selected target — null in add-mode before the user picks. */
  @property({ attribute: false })
  value: AutomationLocation | null = null;

  /** Configured component instances on this device — feeds the
   *  ``component_on`` and ``light_effect`` pickers. */
  @property({ attribute: false })
  devices: AvailableComponentInstance[] = [];

  /** Declared ``script:`` ids on this device. Empty list disables
   *  the ``script`` kind. */
  @property({ attribute: false })
  scripts: AvailableScript[] = [];

  /** Disable picker (during save). */
  @property({ type: Boolean })
  disabled = false;

  /** Lock the kind / instance pickers — used in edit-mode where the
   *  YAML splice destination must stay pinned. The user can still
   *  see what they're editing but can't move the automation. */
  @property({ type: Boolean })
  locked = false;

  static styles = [espHomeStyles, inputStyles, automationEditorStyles];

  protected render() {
    const kind = this.value?.kind ?? "device_on";
    return html`
      <div class="ae-section">
        <label class="ae-section-label" id="target-kind-label"
          >${this._localize("device.automation_target")}</label
        >
        <wa-select
          aria-labelledby="target-kind-label"
          value=${kind}
          ?disabled=${this.disabled || this.locked}
          @change=${this._onKindChange}
        >
          ${ORDER.map(
            (k) => html`<wa-option value=${k} ?selected=${k === kind}
              >${this._kindLabel(k)}</wa-option
            >`,
          )}
        </wa-select>
        ${this._renderKindBody(kind)}
      </div>
    `;
  }

  private _kindLabel(kind: TargetKind): string {
    switch (kind) {
      case "device_on":
        return this._localize("device.automation_target_device");
      case "component_on":
        return this._localize("device.automation_target_component");
      case "interval":
        return this._localize("device.automation_target_interval");
      case "script":
        return this._localize("device.automation_target_script");
      case "api_action":
        // Not in ORDER (api_actions are managed from the api
        // section editor) but still labellable if a pre-existing
        // location lands here through the legacy add-mode path.
        return this._localize("device.automation_target_api_action");
      case "light_effect":
        return this._localize("device.automation_light_effect");
    }
  }

  private _renderKindBody(kind: TargetKind) {
    if (kind === "device_on" || kind === "interval") {
      // No further selection needed — device-level triggers are
      // picked in the trigger step, intervals carry an array index
      // that the writer resolves.
      return nothing;
    }
    if (kind === "component_on") {
      const selectedId =
        this.value?.kind === "component_on" ? this.value.component_id : "";
      if (this.devices.length === 0) {
        return html`<p class="ae-empty" role="status">
          ${this._localize("device.automation_target_no_components")}
        </p>`;
      }
      return html`
        <label class="ae-section-label" id="component-id-label"
          >${this._localize("device.automation_target_component_label")}</label
        >
        <wa-select
          aria-labelledby="component-id-label"
          value=${selectedId}
          ?disabled=${this.disabled || this.locked}
          @change=${(e: Event) =>
            this._onComponentChange((e.target as HTMLSelectElement).value)}
        >
          ${this.devices.map(
            (d) => html`<wa-option value=${d.id} ?selected=${d.id === selectedId}
              >${d.name ?? d.id} <span class="ae-muted">(${d.component_id})</span></wa-option
            >`,
          )}
        </wa-select>
      `;
    }
    if (kind === "script") {
      const selectedId = this.value?.kind === "script" ? this.value.id : "";
      // In edit-mode the user is changing an existing script — pin
      // the id so save targets the right YAML range. In add-mode
      // they're declaring a new script: render a text input so they
      // can name it. ``scripts`` is the list of already-declared
      // scripts; in add-mode it isn't used (we're creating one, not
      // picking one), but the empty-state hint stays useful as a
      // hand-off when the editor is opened in edit-mode and nothing
      // is declared yet.
      if (this.locked) {
        return html`
          <label class="ae-section-label">
            ${this._localize("device.automation_target_script_label")}
          </label>
          <p class="ae-section-desc">${selectedId}</p>
        `;
      }
      return html`
        <label class="ae-section-label" for="script-id-input">
          ${this._localize("device.automation_target_script_new_id_label")}
        </label>
        <input
          id="script-id-input"
          type="text"
          .value=${selectedId}
          placeholder=${this._localize(
            "device.automation_target_script_id_placeholder",
          )}
          ?disabled=${this.disabled}
          @input=${(e: Event) =>
            this._onScriptChange((e.target as HTMLInputElement).value)}
        />
      `;
    }
    if (kind === "api_action") {
      // The picker doesn't let the user create api_actions through
      // this surface (api_actions are managed inline from the api
      // section editor). We still need to render *something* in
      // edit-mode when a pre-existing api-action location lands
      // here — a single read-only line is enough.
      const selectedName =
        this.value?.kind === "api_action" ? this.value.action_name : "";
      return html`
        <label class="ae-section-label">
          ${this._localize("device.automation_target_api_action_label")}
        </label>
        <p class="ae-section-desc">${selectedName}</p>
      `;
    }
    if (kind === "light_effect") {
      const selectedId =
        this.value?.kind === "light_effect" ? this.value.component_id : "";
      const lights = this.devices.filter((d) =>
        d.component_id.startsWith("light."),
      );
      if (lights.length === 0) {
        return html`<p class="ae-empty" role="status">
          ${this._localize("device.automation_target_no_lights")}
        </p>`;
      }
      return html`
        <label class="ae-section-label" id="light-id-label"
          >${this._localize("device.automation_target_light_label")}</label
        >
        <wa-select
          aria-labelledby="light-id-label"
          value=${selectedId}
          ?disabled=${this.disabled || this.locked}
          @change=${(e: Event) =>
            this._onLightChange((e.target as HTMLSelectElement).value)}
        >
          ${lights.map(
            (d) => html`<wa-option value=${d.id} ?selected=${d.id === selectedId}
              >${d.name ?? d.id}</wa-option
            >`,
          )}
        </wa-select>
      `;
    }
    return nothing;
  }

  private _onKindChange(e: Event) {
    const kind = (e.target as HTMLSelectElement).value as TargetKind;
    const next: AutomationLocation | null = (() => {
      switch (kind) {
        case "device_on":
          return { kind, trigger: "on_boot" };
        case "interval":
          return { kind, index: 0 };
        case "component_on":
          return this.devices.length
            ? {
                kind,
                component_id: this.devices[0].id,
                trigger: "",
              }
            : null;
        case "script":
          // Even when no scripts are declared yet, the picker still
          // supports a freshly-typed id in add-mode — so emit a
          // script location with an empty id rather than ``null``,
          // which would snap the kind picker back to the previous
          // selection and block creating the first script via
          // this UI.
          return {
            kind,
            id: this.scripts.length ? this.scripts[0].id : "",
          };
        case "light_effect": {
          const light = this.devices.find((d) =>
            d.component_id.startsWith("light."),
          );
          return light ? { kind, component_id: light.id, index: 0 } : null;
        }
        case "api_action":
          // Unreachable through the dropdown (api_action isn't in
          // ORDER) but kept for the exhaustive switch — the user
          // can't pick it here.
          return null;
      }
    })();
    this._emit(next);
  }

  private _onComponentChange(componentId: string) {
    if (this.value?.kind !== "component_on") return;
    this._emit({ ...this.value, component_id: componentId });
  }

  private _onScriptChange(id: string) {
    this._emit({ kind: "script", id });
  }

  private _onLightChange(componentId: string) {
    if (this.value?.kind !== "light_effect") return;
    this._emit({ ...this.value, component_id: componentId });
  }

  private _emit(target: AutomationLocation | null) {
    this.dispatchEvent(
      new CustomEvent<{ target: AutomationLocation | null }>("target-change", {
        detail: { target },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-automation-target-picker": ESPHomeAutomationTargetPicker;
  }
}
