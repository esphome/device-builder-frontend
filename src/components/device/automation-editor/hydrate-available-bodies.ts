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

/**
 * Hydrate ``config_entries`` for every entry in *available* by
 * fetching its body through the batched body cache. Mutates the
 * passed lists in place (caller already holds the array refs).
 * ``allSettled`` so one fetch failure doesn't abort the rest;
 * missing-``config_entries`` shapes are logged but otherwise
 * skipped (the body cache's ``cacheMisses: false`` lets a re-mount
 * recover).
 */
export async function hydrateAvailableBodies(
  api: ESPHomeAPI,
  available: AvailableAutomations,
  fetchBody: AutomationBodyFetcher = fetchAutomationBody
): Promise<void> {
  const jobs: Promise<unknown>[] = [];
  const merge = (type: _AutomationListType, list: _AutomationEntry[]): void => {
    for (const entry of list) {
      jobs.push(
        fetchBody(api, type, entry.id).then((body) => {
          if (body && "config_entries" in body) {
            // Shallow-clone so downstream form mutations can't
            // poison the shared cache.
            entry.config_entries = [...body.config_entries];
            return;
          }
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
  const results = await Promise.allSettled(jobs);
  for (const r of results) {
    if (r.status === "rejected") {
      console.warn("automation-editor: body fetch failed", r.reason);
    }
  }
}
