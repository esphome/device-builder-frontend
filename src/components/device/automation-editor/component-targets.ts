/**
 * Shared filters for the configured-component instances the automation
 * pickers offer as targets.
 */
import type {
  AutomationTrigger,
  AvailableComponentInstance,
} from "../../../api/types/automations.js";
import type { ConfigEntry } from "../../../api/types/config-entries.js";
import { stripRedundantComponentSuffix } from "../../../util/component-title.js";
import { parseCatalogId } from "../../../util/config-entry-yaml-scan.js";
import { CORE_KEYS } from "../../../util/yaml-sections.js";

/** The instance's display label: its ``name:`` when set, else the catalog
 *  title (core titles trimmed like the navigator), else its id. */
export function instanceName(device: AvailableComponentInstance): string {
  if (device.name) return device.name;
  if (device.title) {
    return CORE_KEYS.has(componentDomain(device.component_id))
      ? stripRedundantComponentSuffix(device.title)
      : device.title;
  }
  return device.id;
}

/** Bare domain of a ``component_id`` (``sensor.aht10`` → ``sensor``). */
export function componentDomain(componentId: string): string {
  return parseCatalogId(componentId).domain;
}

/** The parenthetical context shown beside an instance's label: its domain,
 *  plus the owning container's name when it's a sub-entity, so two readings
 *  named alike (``Temperature``) read distinctly across the picker surfaces. */
export function instanceContext(
  device: AvailableComponentInstance,
  devices: AvailableComponentInstance[]
): string {
  const parent = device.parent_id
    ? devices.find((p) => p.id === device.parent_id)
    : undefined;
  return parent
    ? `${device.component_id} · ${instanceName(parent)}`
    : device.component_id;
}

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

/** *container* plus its direct sub-entities, for scoping a picker to one
 *  multi-entity component; the full list when no container is given. */
export function scopeToContainer(
  devices: AvailableComponentInstance[],
  container?: AvailableComponentInstance
): AvailableComponentInstance[] {
  if (!container) return devices;
  return devices.filter((d) => d.id === container.id || d.parent_id === container.id);
}

/**
 * Pre-fill for a picked item's id-shaped ConfigEntry referencing *device*'s
 * domain: ``{key: device.id}``, or ``undefined`` when the item has no such
 * field or the device's id is synthesized rather than declared in YAML —
 * writing a synthetic id (``logger`` / ``uart_0``) into a reference param
 * produces a dangling id ESPHome rejects (#2208); left empty, ESPHome
 * auto-resolves the instance.
 */
export function preFillIdParam(
  item: { config_entries: ConfigEntry[] },
  device: AvailableComponentInstance
): Record<string, unknown> | undefined {
  if (!device.has_explicit_id) return undefined;
  const domain = componentDomain(device.component_id);
  const idEntry = item.config_entries.find((e) => e.references_component === domain);
  if (!idEntry) return undefined;
  return { [idEntry.key]: device.id };
}

/** Component-level triggers valid for *device*, matched on its bare or
 *  qualified domain; empty when *device* is absent or a container. */
export function triggersForComponent(
  triggers: AutomationTrigger[],
  device: AvailableComponentInstance | undefined
): AutomationTrigger[] {
  if (!device || !isSelectableTarget(device)) return [];
  const domain = componentDomain(device.component_id);
  return triggers.filter(
    (t) =>
      !t.is_device_level &&
      (t.applies_to.includes(device.component_id) || t.applies_to.includes(domain))
  );
}
