/**
 * Shared filters for the configured-component instances the automation
 * pickers offer as targets.
 */
import type {
  AutomationTrigger,
  AvailableComponentInstance,
} from "../../../api/types/automations.js";

/** A multi-entity platform container holds no triggers of its own (its
 *  sub-entities do), so it isn't directly selectable as a target. */
export function isSelectableTarget(device: AvailableComponentInstance): boolean {
  return !device.is_entity_container;
}

/** The instances a picker may offer (containers dropped). */
export function selectableTargets(
  devices: AvailableComponentInstance[]
): AvailableComponentInstance[] {
  return devices.filter(isSelectableTarget);
}

/** The first selectable instance, for defaulting a freshly-chosen kind. */
export function firstSelectableTarget(
  devices: AvailableComponentInstance[]
): AvailableComponentInstance | undefined {
  return devices.find(isSelectableTarget);
}

/** Component-level triggers valid for *device*, matched on its bare or
 *  qualified domain; empty when *device* is absent or a container. */
export function triggersForComponent(
  triggers: AutomationTrigger[],
  device: AvailableComponentInstance | undefined
): AutomationTrigger[] {
  if (!device || !isSelectableTarget(device)) return [];
  const [domain] = device.component_id.split(".");
  return triggers.filter(
    (t) =>
      !t.is_device_level &&
      (t.applies_to.includes(device.component_id) || t.applies_to.includes(domain))
  );
}
