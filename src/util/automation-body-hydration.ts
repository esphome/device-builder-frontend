import type { ESPHomeAPI } from "../api/index.js";
import type {
  AutomationCatalogBody,
  AutomationCatalogBodyType,
} from "../api/types/automations.js";
import type { ConfigEntry, RequiredGroup } from "../api/types/config-entries.js";
import { fetchAutomationBody } from "./automation-body-cache.js";

/** Single source of truth for the per-entry hydration shape. Both
 *  the editor (``hydrate-available-bodies.ts``) and the registry
 *  cache (``automation-catalog-cache.ts``) go through here so the
 *  warn messages, clone semantics, and outcome tags can't drift. */

export type AutomationBodyFetcher = (
  api: ESPHomeAPI,
  type: AutomationCatalogBodyType,
  id: string
) => Promise<AutomationCatalogBody | null>;

export type HydrationOutcome = "ok" | "missingBody" | "missingField";

export interface HydrationResult {
  succeeded: number;
  missingBody: number;
  missingField: number;
  rejected: number;
}

interface _Hydratable {
  id: string;
  config_entries: ConfigEntry[];
  required_groups?: RequiredGroup[] | null;
}

/** Fetch one entry's body and replace ``entry.config_entries`` with
 *  a structurally-disjoint deep copy. Returns an outcome tag so
 *  callers can aggregate failure counts. A null body or missing
 *  ``config_entries`` field is a backend contract violation; we log
 *  it with the offending key + reason so the empty form has a
 *  console breadcrumb. */
export async function hydrateEntryConfigEntries(
  api: ESPHomeAPI,
  type: AutomationCatalogBodyType,
  entry: _Hydratable,
  fetchBody: AutomationBodyFetcher = fetchAutomationBody
): Promise<HydrationOutcome> {
  const body = await fetchBody(api, type, entry.id);
  if (body && "config_entries" in body) {
    // Deep-clone — the cached body and the entry's copy must be
    // structurally disjoint so downstream form mutations can't
    // poison the cache. Wire payload is JSON-shaped so
    // structuredClone is faithful.
    entry.config_entries = structuredClone(body.config_entries);
    // The slim index drops required_groups; the body is its only carrier.
    if ("required_groups" in body) {
      entry.required_groups = structuredClone(body.required_groups);
    }
    return "ok";
  }
  const reason = body === null ? "no body returned" : "body shape missing config_entries";
  console.warn(`automation-body: ${type}/${entry.id} ${reason}; form will render empty`);
  return body === null ? "missingBody" : "missingField";
}

export function emptyHydrationResult(): HydrationResult {
  return { succeeded: 0, missingBody: 0, missingField: 0, rejected: 0 };
}

export function tallyOutcome(result: HydrationResult, outcome: HydrationOutcome): void {
  result[outcome === "ok" ? "succeeded" : outcome]++;
}
