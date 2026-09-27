/**
 * Top-level editor for one ``api.actions:`` entry — a Home
 * Assistant-callable action exposed by the device's ``api:`` block.
 *
 * Structurally a slim sibling of ``<esphome-script-editor>``: a
 * named callable with typed ``variables:`` (instead of ``parameters:``)
 * and a ``then:`` action list, no trigger. The api component has no
 * per-action catalog entry, so the editor doesn't drive the chrome
 * from a ``ComponentCatalogEntry`` — header text and the action-name
 * input live as plain fields.
 *
 * Public surface mirrors the automation/script editors:
 *
 * - ``configuration``, ``board``, ``platform``, ``value``,
 *   ``location``, ``yaml`` props.
 * - Events: ``automation-change``, ``yaml-draft`` / ``yaml-updated``
 *   (auto-apply + delete), ``section-select`` after delete,
 *   ``dirty-change``, ``section-mount`` / ``section-unmount``.
 *
 * Save/delete are optimistic + revert-on-failure per CLAUDE.md.
 * ``inFlightWrite`` signals to the parent's reconnect handler to
 * skip clobbering an in-flight write.
 */
import { mdiOpenInNew, mdiWebhook } from "@mdi/js";
import { html } from "lit";
import { customElement } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";

import type { AutomationLocation } from "../../../api/types/automations.js";
import { ESPHOME_DOCS_BASE } from "../../../common/docs.js";
import { renderMarkdown } from "../../../util/markdown.js";
import { registerMdiIcons } from "../../../util/register-icons.js";
import { actionsFocus, paramFocus } from "./automation-focus.js";
import { CallableAutomationEditor } from "./callable-editor.js";
import { renderActionsSection } from "./render-actions-section.js";
import "./callable-params-editor.js";
import { emptyAutomationTree } from "./serialise.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({
  "open-in-new": mdiOpenInNew,
  webhook: mdiWebhook,
});

/** ESPHome's docs page for the api component (which hosts
 *  ``api.actions:``). Linked from the header so the user lands on
 *  the right docs page from a single click. */
const API_DOCS_URL = `${ESPHOME_DOCS_BASE}/components/api.html`;

/** ``AutomationLocation`` variant for ``api.actions:`` entries —
 *  pulled out as a local alias because the api-action editor only
 *  ever holds this kind. */
type ApiActionLocation = Extract<AutomationLocation, { kind: "api_action" }>;

@customElement("esphome-api-action-editor")
export class ESPHomeApiActionEditor extends CallableAutomationEditor<ApiActionLocation> {
  // Can't upsert an api action with no name.
  protected override _canApply(location: AutomationLocation): boolean {
    return location.kind === "api_action" && !!location.action_name;
  }

  protected override readonly _nameInputId = "api-action-name";

  /** ``service`` is the legacy spelling of ``action``. */
  protected override readonly _nameYamlKeys = ["action", "service"];

  protected render() {
    const gate = this.renderStateGate();
    if (gate) return gate;
    const automation = this.value ?? emptyAutomationTree();
    const devices = this._available?.devices ?? [];
    const scripts = this._available?.scripts ?? [];
    const actions = this._available?.actions ?? [];
    const conditions = this._available?.conditions ?? [];
    const disabled = this._engine.deleting;
    const focus = this._currentFocus();
    return keyed(
      this._target,
      html`
        ${this._renderHeader()}
        ${this._renderNameField(
          {
            label: this._localize("device.api_action_id_label"),
            description: this._localize("device.api_action_id_description"),
            value: this.location?.action_name ?? "",
          },
          disabled
        )}
        <esphome-callable-params-editor
          .value=${(automation.trigger_params.variables ?? {}) as Record<string, string>}
          .focusParam=${paramFocus(focus, "variables")}
          ?disabled=${disabled}
          .fieldLabel=${this._localize("device.api_action_variables")}
          .description=${this._localize("device.api_action_variables_description")}
          .addLabel=${this._localize("device.api_action_add_variable")}
          .namePlaceholder=${this._localize("device.api_action_variable_name_placeholder")}
          @value-change=${this._onVariablesChange}
        ></esphome-callable-params-editor>
        ${renderActionsSection({
          automation,
          catalog: actions,
          conditionCatalog: conditions,
          scripts,
          devices,
          board: this.board,
          yaml: this.yaml,
          disabled,
          localize: this._localize,
          focusTarget: actionsFocus(focus),
          descriptionKey: "device.api_action_actions_description",
          onActionsChange: this._onActionsChange,
        })}
        ${this.renderFooter({
          label: this._localize("device.delete_api_action"),
          message: (location) =>
            this._localize("device.confirm_delete_api_action", {
              name: location.action_name,
            }),
        })}
      `
    );
  }

  private _renderHeader() {
    return html`<div class="ae-header">
      <div class="ae-header-text">
        <h2 class="ae-header-title">
          ${this._localize("device.api_action_header_title_static")}
        </h2>
        <a class="ae-header-docs" href=${API_DOCS_URL} target="_blank" rel="noreferrer">
          ${this._localize("device.docs")}
          <wa-icon library="mdi" name="open-in-new"></wa-icon>
        </a>
        <p class="ae-header-desc">
          ${renderMarkdown(this._localize("device.api_action_header_description"))}
        </p>
      </div>
      <div class="ae-header-icon">
        <wa-icon library="mdi" name="webhook"></wa-icon>
      </div>
    </div>`;
  }

  private _onVariablesChange = (e: CustomEvent<{ value: Record<string, string> }>) => {
    e.stopPropagation();
    const automation = this.value ?? emptyAutomationTree();
    this._engine.withValue({
      trigger_params: {
        ...automation.trigger_params,
        variables: e.detail.value,
      },
    });
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-api-action-editor": ESPHomeApiActionEditor;
  }
}
