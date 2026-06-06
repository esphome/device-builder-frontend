/**
 * renderNestedField auto-expands a group that already holds a YAML value,
 * so advanced groups present in the config (remote_receiver's raw) show
 * their filled fields without a manual expand. Seeding is one-shot, so a
 * later user collapse still sticks (covered by the form's seed marker).
 */
import { describe, expect, it } from "vitest";
import { ConfigEntryType } from "../../../src/api/types/config-entries.js";
import { renderNestedField } from "../../../src/components/device/config-entry-renderers.js";
import { makeEntry, makeRenderCtx } from "./_renderer-fixtures.js";

function rawEntry() {
  return makeEntry(ConfigEntryType.NESTED, {
    key: "raw",
    advanced: true,
    config_entries: [
      makeEntry(ConfigEntryType.STRING, { key: "code", multi_value: true }),
    ],
  });
}

function ctxWithOpenSet(values: unknown) {
  const open = new Set<string>();
  const ctx = makeRenderCtx(values, {
    overrides: { nestedOpenSections: open, seedNestedOpen: (k: string) => open.add(k) },
  });
  return { ctx, open };
}

describe("renderNestedField auto-expand", () => {
  it("seeds a group open when it carries a YAML value", () => {
    const { ctx, open } = ctxWithOpenSet({ raw: { code: [-646, 1467] } });
    renderNestedField(rawEntry(), ["raw"], ctx);
    expect(open.has("raw")).toBe(true);
  });

  it("leaves an empty group collapsed", () => {
    const { ctx, open } = ctxWithOpenSet({});
    renderNestedField(rawEntry(), ["raw"], ctx);
    expect(open.has("raw")).toBe(false);
  });
});
