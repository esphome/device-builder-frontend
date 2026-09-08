/**
 * Trigger-catalog scoping shared by the automation editor, the add
 * dialog, the navigator and the section list.
 *
 * A component trigger's ``applies_to`` names either a bare domain
 * (``sensor``) or a qualified ``<domain>.<platform>`` scope
 * (``sensor.rotary_encoder``); its id ends in the bare ``on_*`` YAML key.
 * Scope lists are ordered most specific first so a platform-scoped
 * trigger wins over a domain-level one sharing the same key.
 */
import type {
  AutomationTrigger,
  AvailableComponentInstance,
} from "../api/types/automations.js";
import { parseCatalogId } from "./config-entry-yaml-scan.js";
import { qualifiedSectionKey } from "./yaml-sections-core.js";

/**
 * The bare YAML key of a catalog trigger id: its last segment.
 * ``"switch.on_turn_on"`` and ``"rotary_encoder.sensor.on_clockwise"``
 * both give their ``on_*`` key; ids without a prefix pass through.
 */
export function bareTriggerKey(catalogId: string): string {
  return catalogId.slice(catalogId.lastIndexOf(".") + 1);
}

/** Scopes an instance matches: its qualified id, then its bare domain. */
export function targetScopes(componentId: string): string[] {
  const { domain } = parseCatalogId(componentId);
  return domain === componentId ? [componentId] : [componentId, domain];
}

/** Scopes an instance hosts triggers under. A multi-entity container's
 *  list item is not an entity, so it drops the bare domain deliberately:
 *  the entity triggers belong to its sub-entities. */
export function instanceScopes(device: AvailableComponentInstance): string[] {
  return device.is_entity_container
    ? [device.component_id]
    : targetScopes(device.component_id);
}

/** Scopes of a handler row: ``<domain>.<platform>`` when a platform item
 *  hosts it, then the bare domain. */
export function handlerScopes(parentKey: string, platform?: string): string[] {
  return platform ? [qualifiedSectionKey(parentKey, platform), parentKey] : [parentKey];
}

/** True for a component-level trigger whose ``applies_to`` meets *scopes*. */
export function triggerAppliesTo(
  t: AutomationTrigger,
  scopes: readonly string[]
): boolean {
  return !t.is_device_level && t.applies_to.some((a) => scopes.includes(a));
}

/** The component trigger for bare key *key*, preferring the earliest scope. */
export function triggerForKey(
  triggers: AutomationTrigger[],
  scopes: readonly string[],
  key: string
): AutomationTrigger | undefined {
  for (const scope of scopes) {
    const hit = triggers.find(
      (t) => bareTriggerKey(t.id) === key && triggerAppliesTo(t, [scope])
    );
    if (hit) return hit;
  }
  return undefined;
}
