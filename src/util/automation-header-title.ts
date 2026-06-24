import type { AutomationLocation, AutomationTrigger } from "../api/types/automations.js";
import type { LocalizeFunc } from "../common/localize.js";

import { actionFieldLabel } from "./action-field-label.js";

/**
 * Editor header title for an automation, derived from its
 * ``location`` and (when known) the picked ``trigger``.
 *
 * - ``interval`` — a static "Interval" label; the index lives
 *   elsewhere in the header.
 * - ``device_on`` / ``component_on`` with a resolved trigger —
 *   the catalog trigger name (``On Turn On``), which doubles as
 *   the identity the header carries.
 * - ``component_action`` — the friendly action-field label
 *   (``open_action`` → "Open action").
 * - everything else (no trigger yet, script, api_action, …) —
 *   the generic static title.
 */
export function automationHeaderTitle(
  location: AutomationLocation | null,
  trigger: AutomationTrigger | null,
  localize: LocalizeFunc
): string {
  if (location?.kind === "interval") {
    return localize("device.automation_interval_label");
  }
  if (trigger && (location?.kind === "device_on" || location?.kind === "component_on")) {
    return trigger.name;
  }
  if (location?.kind === "component_action") {
    return actionFieldLabel(location.field, localize);
  }
  return localize("device.automation_header_title_static");
}
