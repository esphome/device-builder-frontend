/**
 * Pure trigger / target identity helpers for the automation editor.
 * Kept as plain functions (not methods) so the id round-tripping can
 * be unit-tested without mounting the editor, which pulls in
 * CodeMirror.
 *
 * Wire-shape background: ``AutomationTree.trigger_id`` is the
 * catalog-qualified id (``"switch.on_turn_on"`` — what
 * ``catalog.trigger_by_id`` returns a hit for), while
 * ``location.component_on.trigger`` is the BARE YAML key
 * (``"on_turn_on"``) the writer splices under the component; the
 * backend reconstructs the catalog id by combining the component's
 * domain with the bare key. Device-level catalog ids carry no domain
 * prefix, so the two forms coincide for ``device_on``.
 */
import type {
  AutomationLocation,
  AutomationTree,
  AvailableComponentInstance,
} from "../../../api/types/automations.js";
import type { LocalizeFunc } from "../../../common/localize.js";
import { componentDomain, instanceName } from "./component-targets.js";

/**
 * Drop the ``<domain>.`` prefix from a catalog trigger id to get
 * the bare YAML key. ``"switch.on_turn_on"`` → ``"on_turn_on"``.
 * Ids that already lack a domain are passed through.
 */
export function bareTriggerKey(catalogId: string): string {
  const dotIdx = catalogId.indexOf(".");
  return dotIdx >= 0 ? catalogId.slice(dotIdx + 1) : catalogId;
}

/**
 * Build the catalog-qualified trigger id for a ``component_on``
 * location, using the bound device's domain. Returns ``null``
 * for other location kinds or when no trigger is picked; while
 * the device list hasn't loaded yet the bare trigger key is
 * returned unqualified so the caller still has a usable id.
 */
export function catalogTriggerIdFor(
  loc: AutomationLocation,
  devices: AvailableComponentInstance[]
): string | null {
  if (loc.kind !== "component_on" || !loc.trigger) return null;
  const device = devices.find((d) => d.id === loc.component_id);
  const domain = device ? componentDomain(device.component_id) : null;
  return domain ? `${domain}.${loc.trigger}` : loc.trigger;
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
  devices: AvailableComponentInstance[]
): string | null {
  return (
    automation.trigger_id ??
    (target?.kind === "device_on"
      ? target.trigger || null
      : target?.kind === "component_on"
        ? catalogTriggerIdFor(target, devices) || null
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
