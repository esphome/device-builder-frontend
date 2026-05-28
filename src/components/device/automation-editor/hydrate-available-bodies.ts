import type { ESPHomeAPI } from "../../../api/index.js";
import type {
  AutomationAction,
  AutomationCondition,
  AutomationTrigger,
  AvailableAutomations,
} from "../../../api/types.js";
import { fetchAutomationBody } from "../../../util/automation-body-cache.js";

/** Per-entry body fetcher — defaults to the shared cache but is
 *  swappable for unit tests. */
export type AutomationBodyFetcher = typeof fetchAutomationBody;

type _AutomationListType = "triggers" | "actions" | "conditions";
type _AutomationEntry = AutomationTrigger | AutomationAction | AutomationCondition;

/** Aggregate hydration outcome — caller can toast / set _error if
 *  any entries failed. */
export interface HydrationResult {
  /** Entries whose ``config_entries`` was successfully replaced. */
  succeeded: number;
  /** Body fetches that returned null. */
  missingBody: number;
  /** Body shapes lacking ``config_entries``. */
  missingField: number;
  /** Body fetches that threw (transport error, cache cleared, …). */
  rejected: number;
}

/**
 * Hydrate ``config_entries`` for every entry in *available* by
 * fetching its body through the batched body cache. Mutates the
 * passed lists in place. ``allSettled`` so one fetch failure
 * doesn't abort the rest; the returned :class:`HydrationResult`
 * lets the caller decide whether to surface a partial failure
 * (the body cache's ``cacheMisses: false`` lets a re-mount
 * recover from contract-violation misses; transport rejections
 * are also retry-able).
 */
export async function hydrateAvailableBodies(
  api: ESPHomeAPI,
  available: AvailableAutomations,
  fetchBody: AutomationBodyFetcher = fetchAutomationBody
): Promise<HydrationResult> {
  const result: HydrationResult = {
    succeeded: 0,
    missingBody: 0,
    missingField: 0,
    rejected: 0,
  };
  const jobs: Promise<unknown>[] = [];
  const merge = (type: _AutomationListType, list: _AutomationEntry[]): void => {
    for (const entry of list) {
      jobs.push(
        fetchBody(api, type, entry.id).then((body) => {
          if (body && "config_entries" in body) {
            // Shallow-clone the array so add/remove/reorder on the
            // entry's ``config_entries`` can't leak back into the
            // shared cache. Individual ``ConfigEntry`` objects are
            // still aliased; downstream forms must not mutate them
            // in place (they don't today — the form returns a new
            // value, never patches the schema).
            entry.config_entries = [...body.config_entries];
            result.succeeded++;
            return;
          }
          if (body === null) result.missingBody++;
          else result.missingField++;
          const reason =
            body === null ? "no body returned" : "body shape missing config_entries";
          console.warn(
            `automation-editor: ${type}/${entry.id} ${reason}; form will render empty`
          );
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
