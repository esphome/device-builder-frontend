import type { AutomationLocation, AutomationTrigger } from "../api/types/automations.js";
import type { ComponentCatalogEntry } from "../api/types/components.js";
import type { ConfigEntry } from "../api/types/config-entries.js";

/**
 * Resolve the ``config_entries`` list that drives the trigger-params
 * form in the automation editor.
 *
 * - ``interval`` — the trigger's own ``then:`` block carries no
 *   config_entries, so the form pulls from the interval component's
 *   schema instead, minus the ``then`` actions block (rendered by the
 *   action-list, not the form). With no resolved component yet, there
 *   is nothing to show.
 * - everything else — the active trigger's own ``config_entries``.
 */
export function triggerParamFormEntries(
  location: AutomationLocation | null,
  intervalComponent: ComponentCatalogEntry | null,
  activeTrigger: AutomationTrigger | null
): ConfigEntry[] {
  if (location?.kind === "interval") {
    if (!intervalComponent) return [];
    return intervalComponent.config_entries.filter((e) => e.key !== "then");
  }
  return activeTrigger?.config_entries ?? [];
}
