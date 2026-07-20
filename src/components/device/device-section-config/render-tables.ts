/**
 * Inline manage-lists (api actions, triggers, component action fields)
 * plus the shared notice shell and the delete actions row.
 */
import { html, nothing, type TemplateResult } from "lit";
import { actionFieldLabel } from "../../../util/action-field-label.js";
import { parseYamlAutomations, type YamlSection } from "../../../util/yaml-sections.js";
import type { ESPHomeDeviceSectionConfig } from "../device-section-config.js";
import { selectActionFieldRows, selectTriggerRows } from "./automation-rows.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "../device-section-automation-list.js";

/** The info-notice shell shared by the YAML-only and platform-domain
 *  states; *body* supplies the message and its CTA. */
export function renderNotice(body: TemplateResult) {
  return html`<div class="yaml-only-notice" role="note">
    <wa-icon library="mdi" name="information-outline"></wa-icon>
    <div class="yaml-only-notice-body">${body}</div>
  </div>`;
}

export function renderActionsRow(host: ESPHomeDeviceSectionConfig, canDelete: boolean) {
  if (!canDelete) return nothing;
  return html`<div class="actions">${renderDeleteButton(host)}</div>`;
}

/**
 * Inline manage-list of api_action entries. Rendered only for the
 * api section, through the shared automation-list component (one
 * surface for api actions, triggers, and component action fields).
 */
export function renderApiActionsTable(host: ESPHomeDeviceSectionConfig) {
  if (host.sectionKey !== "api") return nothing;
  const rows = parseYamlAutomations(host.yaml)
    .filter((s) => s.key.startsWith("automation:api_action:"))
    .map((s) => ({ key: s.key, label: s.id ?? "" }));
  return html`<esphome-section-automation-list
    .heading=${host._localize("device.api_actions_list_title")}
    .rows=${rows}
    add-label=${host._localize("device.add_api_action")}
    empty-text=${host._localize("device.api_actions_list_empty")}
    edit-label=${host._localize("device.api_actions_list_edit")}
    delete-label=${host._localize("device.api_actions_list_delete")}
    busy-key=${host._deletingRow}
    @add=${host._onOpenAddApiAction}
    @edit=${host._onEditRow}
    @delete=${host._onDeleteRow}
  ></esphome-section-automation-list>`;
}

/**
 * Inline manage-list of inline trigger automations for the current
 * section — ``component_on`` triggers on a component instance
 * (filtered by ``id``) or ``device_on`` triggers under ``esphome:``.
 * Rendered through the shared automation-list component.
 */
export function renderTriggersTable(host: ESPHomeDeviceSectionConfig) {
  const target = host._shortcutTarget();
  if (target === null) return nothing;
  const rows = selectTriggerRows(parseYamlAutomations(host.yaml), target, (s) =>
    triggerLabel(host, s)
  );
  const heading =
    target.kind === "device_on"
      ? host._localize("device.automations_list_title_device")
      : host._localize("device.automations_list_title");
  return html`<esphome-section-automation-list
    .heading=${heading}
    .rows=${rows}
    add-label=${host._localize("device.add_automation")}
    empty-text=${host._localize("device.automations_list_empty")}
    edit-label=${host._localize("device.automations_list_edit")}
    delete-label=${host._localize("device.automations_list_delete")}
    busy-key=${host._deletingRow}
    @add=${host._onOpenAddAutomation}
    @edit=${host._onEditRow}
    @delete=${host._onDeleteRow}
  ></esphome-section-automation-list>`;
}

/**
 * Inline manage-list of component action-list config fields (cover
 * ``open_action`` / ``close_action`` / …) for the current instance.
 * No add affordance — the fields are fixed by the platform — so the
 * shared list renders nothing when the instance declares none.
 */
export function renderActionFieldsTable(host: ESPHomeDeviceSectionConfig) {
  const componentId = host._resolveComponentId();
  if (componentId === null) return nothing;
  const rows = selectActionFieldRows(
    parseYamlAutomations(host.yaml),
    componentId,
    (field) => actionFieldLabel(field, host._localize)
  );
  return html`<esphome-section-automation-list
    .heading=${host._localize("device.action_fields_list_title")}
    .rows=${rows}
    edit-label=${host._localize("device.action_fields_list_edit")}
    delete-label=${host._localize("device.action_fields_list_delete")}
    busy-key=${host._deletingRow}
    @edit=${host._onEditRow}
    @delete=${host._onDeleteRow}
  ></esphome-section-automation-list>`;
}

function renderDeleteButton(host: ESPHomeDeviceSectionConfig) {
  return html`<button
    class="delete-button"
    ?disabled=${host._deleting}
    @click=${() => host._confirmDialog?.open()}
  >
    <wa-icon library="mdi" name="delete"></wa-icon>
    ${host._localize("device.delete_section")}
  </button>`;
}

/** Pretty trigger label for an automations-list row, resolved from
 *  the trigger catalog ("Binary Sensor → On State"). Falls back to
 *  ``displayLabel`` / the raw event key until the catalog loads. */
function triggerLabel(host: ESPHomeDeviceSectionConfig, item: YamlSection): string {
  const fallback = item.displayLabel || item.eventKey || "";
  if (!item.eventKey) return fallback;
  return host._triggerCatalog.resolveName(
    item.parentKey ?? "esphome",
    item.eventKey,
    fallback
  );
}
