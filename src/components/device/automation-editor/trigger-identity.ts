/**
 * Pure trigger / target identity helpers for the automation editor.
 * Kept as plain functions (not methods) so the id round-tripping can
 * be unit-tested without mounting the editor, which pulls in
 * CodeMirror.
 *
 * Wire-shape background: ``AutomationTree.trigger_id`` is the
 * catalog-qualified id (``"switch.on_turn_on"``, or the platform-scoped
 * ``"rotary_encoder.sensor.on_clockwise"`` — what
 * ``catalog.trigger_by_id`` returns a hit for), while
 * ``location.component_on.trigger`` is the BARE YAML key
 * (``"on_turn_on"``) the writer splices under the component; the
 * backend reconstructs the catalog id from the component's platform
 * and domain plus the bare key. Device-level catalog ids carry no
 * domain prefix, so the two forms coincide for ``device_on``.
 */
import type {
  AutomationLocation,
  AutomationTree,
  AutomationTrigger,
  AvailableComponentInstance,
} from "../../../api/types/automations.js";
import type { LocalizeFunc } from "../../../common/localize.js";
import {
  instanceName,
  isSelectableTarget,
  targetScopes,
  triggerAppliesTo,
} from "./component-targets.js";

/**
 * The bare YAML key of a catalog trigger id: its last segment.
 * ``"switch.on_turn_on"`` and ``"rotary_encoder.sensor.on_clockwise"``
 * both give their ``on_*`` key; ids without a prefix pass through.
 */
export function bareTriggerKey(catalogId: string): string {
  return catalogId.slice(catalogId.lastIndexOf(".") + 1);
}

/** The component trigger offered within *scopes* whose bare YAML key is *key*. */
export function triggerForKey(
  triggers: AutomationTrigger[],
  scopes: readonly string[],
  key: string
): AutomationTrigger | undefined {
  return triggers.find(
    (t) => bareTriggerKey(t.id) === key && triggerAppliesTo(t, scopes)
  );
}

/**
 * The catalog-qualified trigger id for a ``component_on`` location:
 * the trigger offered to the bound device under that bare key. Returns
 * ``null`` for other location kinds or when no trigger is picked, and
 * the bare key itself while the device or its triggers are unknown so
 * the caller still has a usable id.
 */
export function catalogTriggerIdFor(
  loc: AutomationLocation,
  devices: AvailableComponentInstance[],
  triggers: AutomationTrigger[]
): string | null {
  if (loc.kind !== "component_on" || !loc.trigger) return null;
  const device = devices.find((d) => d.id === loc.component_id);
  if (!device || !isSelectableTarget(device)) return loc.trigger;
  return (
    triggerForKey(triggers, targetScopes(device.component_id), loc.trigger)?.id ??
    loc.trigger
  );
}

/**
 * The editor's effective trigger id. For ``device_on`` and
 * ``component_on`` the trigger lives in the location alongside the
 * YAML splice destination; mirror it into the effective id so the
 * picker shows the right selection on first paint without a manual
 * sync step. ``device_on``'s two id forms coincide (no domain
 * prefix), so its bare key passes through unqualified.
 */
export function effectiveTriggerIdFor(
  automation: AutomationTree,
  target: AutomationLocation | null,
  devices: AvailableComponentInstance[],
  triggers: AutomationTrigger[]
): string | null {
  return (
    automation.trigger_id ??
    (target?.kind === "device_on"
      ? target.trigger || null
      : target?.kind === "component_on"
        ? catalogTriggerIdFor(target, devices, triggers) || null
        : null)
  );
}

/**
 * Compose the single TARGET row value. For component_on this is
 * the bound device's display name + catalog id (e.g.
 * "Warmtepomp (switch.gpio)") — no separate "Which component?"
 * row. For device_on it's "The device itself"; for interval
 * it's "Interval #N"; for script / api_action / light_effect
 * the row shows their own identifier (script id, action name,
 * component id) since those land in their own editors anyway.
 */
export function targetMetadataValue(
  loc: AutomationLocation,
  devices: AvailableComponentInstance[],
  localize: LocalizeFunc
): string {
  switch (loc.kind) {
    case "device_on":
      return localize("device.automation_target_device");
    case "component_on":
    case "component_action": {
      const device = devices.find((d) => d.id === loc.component_id);
      if (!device) return loc.component_id;
      return `${instanceName(device)} (${device.component_id})`;
    }
    case "interval":
      return localize("device.automation_target_interval_n", {
        index: loc.index + 1,
      });
    case "script":
      return loc.id;
    case "api_action":
      return loc.action_name;
    case "light_effect":
      return loc.component_id;
  }
}
