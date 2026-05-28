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

/** Discriminated outcome of :func:`loadAndHydrateAvailable`. */
export type LoadAndHydrateOutcome =
  | { status: "ok"; available: AvailableAutomations; hydration: HydrationResult }
  | { status: "stale" }
  | { status: "error"; error: unknown };

/** Fetch the slim ``AvailableAutomations`` for *configuration* and
 *  hydrate ``config_entries`` for every entry, returning fresh
 *  array references so identity-based ``hasChanged`` consumers
 *  re-render with the hydrated entries. The caller owns the
 *  state-mutation policy (``_available`` / ``_loading`` /
 *  ``_error`` on the editor element); this function is a thin
 *  orchestration wrapper that the editor element wires into its
 *  Lit lifecycle.
 *
 *  ``onSlim`` lets the caller paint the picker with the slim list
 *  immediately, before awaiting hydration. The slim snapshot is
 *  guaranteed stable — hydration runs against a per-entry shallow
 *  clone so ``config_entries`` mutations land on ``available`` and
 *  never on the ``slim`` object the caller paints from. ``isStale``
 *  is checked after each await so an overlapping load can bail
 *  out cleanly. */
export async function loadAndHydrateAvailable(
  api: ESPHomeAPI,
  configuration: string,
  options?: {
    onSlim?: (slim: AvailableAutomations) => void;
    isStale?: () => boolean;
  }
): Promise<LoadAndHydrateOutcome> {
  try {
    const slim = await api.getAvailableAutomations(configuration);
    if (options?.isStale?.()) return { status: "stale" };
    options?.onSlim?.(slim);
    // Shallow-clone each entry so ``hydrateAvailableBodies``
    // mutates ``available``'s copies, not the ``slim`` snapshot.
    // Entry-level ``config_entries`` reassignment ends in a deep
    // ``structuredClone`` inside the per-entry hydrator, so the
    // cached body stays disjoint either way.
    const available: AvailableAutomations = {
      ...slim,
      triggers: slim.triggers.map((e) => ({ ...e })),
      actions: slim.actions.map((e) => ({ ...e })),
      conditions: slim.conditions.map((e) => ({ ...e })),
    };
    const hydration = await hydrateAvailableBodies(api, available);
    if (options?.isStale?.()) return { status: "stale" };
    return { status: "ok", available, hydration };
  } catch (error) {
    if (options?.isStale?.()) return { status: "stale" };
    return { status: "error", error };
  }
}
