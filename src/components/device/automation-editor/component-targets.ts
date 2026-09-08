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
import { instanceScopes, triggerAppliesTo } from "../../../util/trigger-scopes.js";
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

/**
 * The parenthetical context beside an instance's label: its component id,
 * plus the owning container's name when it's a sub-entity, so two readings
 * named alike (``Temperature``) read distinctly. Resolves parents against
 * every instance, including containers a picker filters out.
 */
export function instanceContext(
  devices: AvailableComponentInstance[]
): (device: AvailableComponentInstance) => string {
  const byId = new Map(devices.map((d) => [d.id, d]));
  return (device) => {
    const parent = device.parent_id ? byId.get(device.parent_id) : undefined;
    return parent
      ? `${device.component_id} · ${instanceName(parent)}`
      : device.component_id;
  };
}

/** A ``component_on`` target: any instance but a multi-entity container,
 *  which qualifies only when a trigger is scoped to its own platform
 *  (``sensor.ltr501``); the entity triggers belong to its sub-entities.
 *  A plain instance never has to prove it hosts a trigger, so a domain
 *  without triggers still lists its instances. */
export function isTriggerTarget(
  device: AvailableComponentInstance,
  triggers: AutomationTrigger[]
): boolean {
  if (!device.is_entity_container) return true;
  const scopes = instanceScopes(device);
  return triggers.some((t) => triggerAppliesTo(t, scopes));
}

/** An entity an action can reference: never a multi-entity container. */
export function isActionTarget(device: AvailableComponentInstance): boolean {
  return !device.is_entity_container;
}

/** The first ``component_on`` target, for defaulting a freshly-chosen kind. */
export function firstTriggerTarget(
  devices: AvailableComponentInstance[],
  triggers: AutomationTrigger[]
): AvailableComponentInstance | undefined {
  return devices.find((d) => isTriggerTarget(d, triggers));
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

/** Component-level triggers the picker offers *device*, matched on the
 *  scopes it hosts triggers under. */
export function triggersForComponent(
  triggers: AutomationTrigger[],
  device: AvailableComponentInstance | undefined
): AutomationTrigger[] {
  if (!device) return [];
  const scopes = instanceScopes(device);
  return triggers.filter((t) => triggerAppliesTo(t, scopes));
}
