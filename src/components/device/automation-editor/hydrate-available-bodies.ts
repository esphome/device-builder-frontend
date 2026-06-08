import toast from "sonner-js";

import type { ESPHomeAPI } from "../../../api/index.js";
import type {
  AutomationAction,
  AutomationCondition,
  AutomationTrigger,
  AvailableAutomations,
} from "../../../api/types/automations.js";
import type { LocalizeFunc } from "../../../common/localize.js";
import {
  emptyHydrationResult,
  hydrateEntryConfigEntries,
  tallyOutcome,
  type AutomationBodyFetcher,
  type HydrationResult,
} from "../../../util/automation-body-hydration.js";
import { getErrorMessage } from "../../../util/error-message.js";

/** Which catalog lists to hydrate bodies for. A consumer that renders
 *  only some of them (the trigger-less editors never show triggers)
 *  passes a subset to skip the unused ``get_bodies`` work. */
export type HydrateList = "triggers" | "actions" | "conditions";
type _AutomationEntry = AutomationTrigger | AutomationAction | AutomationCondition;

const _ALL_LISTS: readonly HydrateList[] = ["triggers", "actions", "conditions"];

/** Hydrate ``config_entries`` for every entry in *available* via the
 *  shared per-entry helper. *lists* selects which catalog lists to
 *  hydrate (default all three). ``allSettled`` so a single rejection
 *  doesn't abort the rest; the returned aggregate lets the caller
 *  surface partial-failure UI (the body cache's
 *  ``cacheMisses: false`` lets a re-mount retry contract-violation
 *  misses, and transport rejections are also retry-able). */
export async function hydrateAvailableBodies(
  api: ESPHomeAPI,
  available: AvailableAutomations,
  fetchBody?: AutomationBodyFetcher,
  lists: readonly HydrateList[] = _ALL_LISTS
): Promise<HydrationResult> {
  const result = emptyHydrationResult();
  const jobs: Promise<unknown>[] = [];
  const merge = (type: HydrateList, list: _AutomationEntry[]): void => {
    for (const entry of list) {
      jobs.push(
        hydrateEntryConfigEntries(api, type, entry, fetchBody).then((outcome) => {
          tallyOutcome(result, outcome);
        })
      );
    }
  };
  if (lists.includes("triggers")) merge("triggers", available.triggers);
  if (lists.includes("actions")) merge("actions", available.actions);
  if (lists.includes("conditions")) merge("conditions", available.conditions);
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
 *  hydrate ``config_entries`` for every entry. The orchestration
 *  builds a per-entry shallow clone with ``config_entries`` backed
 *  by an empty array (the wire-shape backend slims drop the field
 *  entirely), so child renderers can read ``.config_entries.length``
 *  before hydration completes without a crash. The caller owns the
 *  state-mutation policy (``_available`` / ``_loading`` /
 *  ``_error`` on the editor element).
 *
 *  ``onPaint`` fires with the normalized pre-hydration object so
 *  the picker dropdowns can mount immediately. Hydration mutates
 *  the same object's per-entry ``config_entries`` in place; the
 *  returned ``available`` carries fresh array refs so identity-
 *  checking ``hasChanged`` consumers re-render with the hydrated
 *  entries. ``isStale`` is checked after each await so an
 *  overlapping load can bail out cleanly. */
export async function loadAndHydrateAvailable(
  api: ESPHomeAPI,
  configuration: string,
  options?: {
    onPaint?: (available: AvailableAutomations) => void;
    isStale?: () => boolean;
    lists?: readonly HydrateList[];
  }
): Promise<LoadAndHydrateOutcome> {
  try {
    const slim = await api.getAvailableAutomations(configuration);
    if (options?.isStale?.()) return { status: "stale" };
    // Shallow-clone each entry so ``hydrateAvailableBodies``
    // mutates ``available``'s copies, not the api-client object
    // (other consumers paint with the same reference). The client
    // already backfills missing ``config_entries`` to ``[]`` at the
    // wire boundary, so pre-hydration renders are safe.
    const available: AvailableAutomations = {
      ...slim,
      triggers: slim.triggers.map((e) => ({ ...e })),
      actions: slim.actions.map((e) => ({ ...e })),
      conditions: slim.conditions.map((e) => ({ ...e })),
    };
    options?.onPaint?.(available);
    const hydration = await hydrateAvailableBodies(
      api,
      available,
      undefined,
      options?.lists
    );
    if (options?.isStale?.()) return { status: "stale" };
    // Fresh array refs so identity-based ``hasChanged`` consumers
    // re-render with the hydrated entries (entries' object identity
    // is preserved so per-entry caches stay valid).
    const refreshed: AvailableAutomations = {
      ...available,
      triggers: [...available.triggers],
      actions: [...available.actions],
      conditions: [...available.conditions],
    };
    return { status: "ok", available: refreshed, hydration };
  } catch (error) {
    if (options?.isStale?.()) return { status: "stale" };
    return { status: "error", error };
  }
}

/** Map a :func:`loadAndHydrateAvailable` outcome to the
 *  ``_available`` / ``_error`` an editor assigns, surfacing partial
 *  hydration as a non-blocking toast. A ``stale`` outcome yields
 *  neither field so an overlapping load wins. The concurrency token
 *  that makes the ``stale`` branch reachable is owned by
 *  ``CatalogLoadController`` — editors never call this unguarded. */
export function resolveLoadedAvailable(
  outcome: LoadAndHydrateOutcome,
  localize: LocalizeFunc
): { available?: AvailableAutomations; error?: string } {
  if (outcome.status === "stale") return {};
  if (outcome.status === "error") {
    return {
      error: getErrorMessage(outcome.error),
    };
  }
  const { missingBody, missingField, rejected } = outcome.hydration;
  const failures = missingBody + missingField + rejected;
  if (failures > 0) {
    toast.error(
      localize("device.automation_partial_hydration", { count: String(failures) }),
      { richColors: true }
    );
  }
  return { available: outcome.available };
}
