import type { ESPHomeAPI } from "../../../api/index.js";
import type {
  AutomationAction,
  AutomationCondition,
  AutomationTrigger,
  AvailableAutomations,
} from "../../../api/types.js";
import {
  emptyHydrationResult,
  hydrateEntryConfigEntries,
  tallyOutcome,
  type AutomationBodyFetcher,
  type HydrationResult,
} from "../../../util/automation-body-hydration.js";

export type { AutomationBodyFetcher, HydrationResult };

type _AutomationListType = "triggers" | "actions" | "conditions";
type _AutomationEntry = AutomationTrigger | AutomationAction | AutomationCondition;

/** Hydrate ``config_entries`` for every entry in *available* via the
 *  shared per-entry helper. ``allSettled`` so a single rejection
 *  doesn't abort the rest; the returned aggregate lets the caller
 *  surface partial-failure UI (the body cache's
 *  ``cacheMisses: false`` lets a re-mount retry contract-violation
 *  misses, and transport rejections are also retry-able). */
export async function hydrateAvailableBodies(
  api: ESPHomeAPI,
  available: AvailableAutomations,
  fetchBody?: AutomationBodyFetcher
): Promise<HydrationResult> {
  const result = emptyHydrationResult();
  const jobs: Promise<unknown>[] = [];
  const merge = (type: _AutomationListType, list: _AutomationEntry[]): void => {
    for (const entry of list) {
      jobs.push(
        hydrateEntryConfigEntries(api, type, entry, fetchBody).then((outcome) => {
          tallyOutcome(result, outcome);
        })
      );
    }
  };
  merge("triggers", available.triggers);
  merge("actions", available.actions);
  merge("conditions", available.conditions);
  const settled = await Promise.allSettled(jobs);
  for (const r of settled) {
    if (r.status === "rejected") {
      result.rejected++;
      console.warn("automation-editor: body fetch failed", r.reason);
    }
  }
  return result;
}
