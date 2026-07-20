import type { YamlSection } from "../../../util/yaml-sections.js";
import type { ShortcutTarget } from "./shortcut-target.js";

/** A row for the inline ``esphome-section-automation-list``: a stable
 *  delete/edit key plus the user-visible label. */
export interface AutomationRow {
  key: string;
  label: string;
}

/**
 * Select and label the inline trigger-automation rows for a section's
 * shortcut target. ``device_on`` lists ``esphome:`` triggers; a
 * ``component_on`` target lists the instance's own triggers plus those on
 * its sub-entities (matched by ``parentComponentId``). A sub-entity row is
 * prefixed with its name so two readings' identically-named triggers
 * (Temperature/Humidity → On Value) read distinctly within the parent's
 * section. ``triggerLabel`` injects the catalog-resolved pretty name so this
 * stays pure over the trigger-catalog controller.
 */
export function selectTriggerRows(
  sections: readonly YamlSection[],
  target: Exclude<ShortcutTarget, null>,
  triggerLabel: (section: YamlSection) => string
): AutomationRow[] {
  return sections
    .filter((s) => {
      if (!s.eventKey) return false;
      if (target.kind === "device_on") return s.parentKey === "esphome";
      return s.id === target.componentId || s.parentComponentId === target.componentId;
    })
    .map((s) => ({
      key: s.key,
      label:
        s.parentComponentId !== undefined
          ? `${s.name ?? s.id} → ${triggerLabel(s)}`
          : triggerLabel(s),
    }));
}

/**
 * Select and label the component action-list field rows (cover
 * ``open_action`` / ``close_action`` / …) for the instance identified by
 * ``componentId``. ``fieldLabel`` injects the localized field name so this
 * stays free of the i18n function.
 */
export function selectActionFieldRows(
  sections: readonly YamlSection[],
  componentId: string,
  fieldLabel: (field: string) => string
): AutomationRow[] {
  return sections
    .filter(
      (s): s is YamlSection & { actionField: string } =>
        s.actionField !== undefined && s.id === componentId
    )
    .map((s) => ({
      key: s.key,
      label: fieldLabel(s.actionField),
    }));
}

/** Rows for the api section's ``api_action`` manage-list. */
export function selectApiActionRows(sections: readonly YamlSection[]): AutomationRow[] {
  return sections
    .filter((s) => s.key.startsWith("automation:api_action:"))
    .map((s) => ({ key: s.key, label: s.id ?? "" }));
}
