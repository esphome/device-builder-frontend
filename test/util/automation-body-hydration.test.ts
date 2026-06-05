/**
 * Tests for ``src/util/automation-body-hydration.ts`` — the single
 * source of truth for per-entry automation-body hydration. Both the
 * editor (``hydrate-available-bodies.ts``) and the registry cache
 * (``automation-catalog-cache.ts``) route through these helpers so
 * the warn messages, clone semantics, and outcome tags can't drift.
 *
 * Three contracts under test:
 *
 *  - ``hydrateEntryConfigEntries`` — fetches one entry's body and
 *    replaces ``entry.config_entries`` with a structurally-disjoint
 *    deep copy, returning an outcome tag. A null body or a body
 *    missing ``config_entries`` is a backend contract violation that
 *    must be tagged (``missingBody`` / ``missingField``) and logged,
 *    never silently swallowed.
 *  - ``emptyHydrationResult`` — a fresh zeroed tally (no shared
 *    reference between calls).
 *  - ``tallyOutcome`` — folds an outcome into a tally, mapping ``ok``
 *    to ``succeeded`` and every other tag to its like-named field.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ESPHomeAPI } from "../../src/api/index.js";
import type { AutomationCatalogBody } from "../../src/api/types/automations.js";
import type { ConfigEntry } from "../../src/api/types/config-entries.js";
import {
  emptyHydrationResult,
  hydrateEntryConfigEntries,
  tallyOutcome,
  type HydrationResult,
} from "../../src/util/automation-body-hydration.js";

const configEntry = (key: string): ConfigEntry => ({ key }) as ConfigEntry;

const bodyWithEntries = (id: string, entries: ConfigEntry[]): AutomationCatalogBody =>
  ({
    id,
    name: id,
    description: "",
    docs_url: "",
    config_entries: entries,
  }) as AutomationCatalogBody;

const makeApi = () => ({}) as ESPHomeAPI;

// A hydratable entry mirrors the ``_Hydratable`` shape the util
// accepts: an id + a mutable ``config_entries`` array.
const hydratable = (id: string) => ({ id, config_entries: [] as ConfigEntry[] });

// Restore any console spies even when an assertion throws mid-test, so
// a silenced ``console.warn`` can't leak into later tests in this file.
afterEach(() => vi.restoreAllMocks());

describe("hydrateEntryConfigEntries", () => {
  it("populates config_entries from the fetched body and returns ok", async () => {
    const source = [configEntry("foo"), configEntry("bar")];
    const fetchBody = vi.fn(async () => bodyWithEntries("good", source));
    const entry = hydratable("good");

    const outcome = await hydrateEntryConfigEntries(
      makeApi(),
      "triggers",
      entry,
      fetchBody
    );

    expect(outcome).toBe("ok");
    expect(entry.config_entries).toEqual(source);
  });

  it("forwards (api, type, id) to the injected fetcher", async () => {
    const api = makeApi();
    const fetchBody = vi.fn(async () => bodyWithEntries("act", []));
    const entry = hydratable("turn_on");

    await hydrateEntryConfigEntries(api, "actions", entry, fetchBody);

    expect(fetchBody).toHaveBeenCalledTimes(1);
    expect(fetchBody).toHaveBeenCalledWith(api, "actions", "turn_on");
  });

  it("deep-clones so the entry's copy is structurally disjoint from the body", async () => {
    const source = [configEntry("foo"), configEntry("bar")];
    const body = bodyWithEntries("good", source);
    const fetchBody = vi.fn(async () => body);
    const entry = hydratable("good");

    await hydrateEntryConfigEntries(makeApi(), "triggers", entry, fetchBody);

    // The array is a fresh reference (add/remove/reorder safety)...
    expect(entry.config_entries).not.toBe(source);
    // ...and each element is a fresh object (in-place mutation safety).
    expect(entry.config_entries[0]).not.toBe(source[0]);

    // Mutating the hydrated copy must not poison the cached body.
    (entry.config_entries[0] as unknown as { key: string }).key = "mutated";
    expect(source[0].key).toBe("foo");
    if ("config_entries" in body) {
      expect(body.config_entries[0].key).toBe("foo");
    }
  });

  it("tags a null body as missingBody, leaves config_entries untouched, and warns", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchBody = vi.fn(async () => null);
    const entry = hydratable("gone");
    const original = entry.config_entries;

    const outcome = await hydrateEntryConfigEntries(
      makeApi(),
      "conditions",
      entry,
      fetchBody
    );

    expect(outcome).toBe("missingBody");
    expect(entry.config_entries).toBe(original);
    expect(warn).toHaveBeenCalledTimes(1);
    const msg = String(warn.mock.calls[0][0]);
    expect(msg).toContain("conditions/gone");
    expect(msg).toContain("no body returned");
  });

  it("tags a body without config_entries as missingField and warns", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // A body shape that omits the config_entries field entirely.
    const fetchBody = vi.fn(
      async () => ({ id: "weird", name: "weird" }) as unknown as AutomationCatalogBody
    );
    const entry = hydratable("weird");
    const original = entry.config_entries;

    const outcome = await hydrateEntryConfigEntries(
      makeApi(),
      "filters",
      entry,
      fetchBody
    );

    expect(outcome).toBe("missingField");
    expect(entry.config_entries).toBe(original);
    expect(warn).toHaveBeenCalledTimes(1);
    const msg = String(warn.mock.calls[0][0]);
    expect(msg).toContain("filters/weird");
    expect(msg).toContain("body shape missing config_entries");
  });

  it("clones an empty config_entries list to a distinct empty array", async () => {
    const source: ConfigEntry[] = [];
    const fetchBody = vi.fn(async () => bodyWithEntries("empty", source));
    const entry = hydratable("empty");

    const outcome = await hydrateEntryConfigEntries(
      makeApi(),
      "light_effects",
      entry,
      fetchBody
    );

    expect(outcome).toBe("ok");
    expect(entry.config_entries).toEqual([]);
    expect(entry.config_entries).not.toBe(source);
  });
});

describe("emptyHydrationResult", () => {
  it("returns an all-zero tally", () => {
    expect(emptyHydrationResult()).toEqual({
      succeeded: 0,
      missingBody: 0,
      missingField: 0,
      rejected: 0,
    });
  });

  it("returns a fresh object each call (no shared reference)", () => {
    const a = emptyHydrationResult();
    const b = emptyHydrationResult();
    expect(a).not.toBe(b);
    a.succeeded++;
    expect(b.succeeded).toBe(0);
  });
});

describe("tallyOutcome", () => {
  it("maps ok to succeeded", () => {
    const result = emptyHydrationResult();
    tallyOutcome(result, "ok");
    expect(result).toEqual({
      succeeded: 1,
      missingBody: 0,
      missingField: 0,
      rejected: 0,
    });
  });

  it("maps missingBody and missingField to their like-named fields", () => {
    const result = emptyHydrationResult();
    tallyOutcome(result, "missingBody");
    tallyOutcome(result, "missingField");
    expect(result).toEqual({
      succeeded: 0,
      missingBody: 1,
      missingField: 1,
      rejected: 0,
    });
  });

  it("accumulates repeated outcomes", () => {
    const result: HydrationResult = emptyHydrationResult();
    tallyOutcome(result, "ok");
    tallyOutcome(result, "ok");
    tallyOutcome(result, "missingBody");
    expect(result.succeeded).toBe(2);
    expect(result.missingBody).toBe(1);
    expect(result.rejected).toBe(0);
  });
});
