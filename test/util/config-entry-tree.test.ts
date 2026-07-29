/** Unit tests for `pathIsAdvanced`. */
import { describe, expect, it } from "vitest";

import type { ConfigEntry } from "../../src/api/types/config-entries.js";
import { ConfigEntryType } from "../../src/api/types/config-entries.js";
import { pathIsAdvanced } from "../../src/util/config-entry-tree.js";

function entry(key: string, advanced: boolean): ConfigEntry {
  return { key, type: ConfigEntryType.STRING, label: key, advanced } as ConfigEntry;
}

function nested(key: string, advanced: boolean, children: ConfigEntry[]): ConfigEntry {
  return {
    key,
    type: ConfigEntryType.NESTED,
    label: key,
    advanced,
    config_entries: children,
  } as ConfigEntry;
}

describe("pathIsAdvanced", () => {
  const entries = [
    entry("name", false),
    entry("hide_timestamp", true),
    nested("filters", false, [entry("multiply", true)]),
    nested("calibrate", true, [entry("method", false)]),
  ];

  it("is true for an advanced leaf", () => {
    expect(pathIsAdvanced(entries, ["hide_timestamp"], {})).toBe(true);
  });

  it("is false for a hidden entry — revealing advanced can't show it", () => {
    const hidden = {
      key: "actions",
      type: ConfigEntryType.NESTED,
      label: "Actions",
      advanced: true,
      hidden: true,
    } as ConfigEntry;
    expect(pathIsAdvanced([...entries, hidden], ["actions"], {})).toBe(false);
    expect(pathIsAdvanced([...entries, hidden], ["actions", "then"], {})).toBe(false);
  });

  it("is false for a plain leaf", () => {
    expect(pathIsAdvanced(entries, ["name"], {})).toBe(false);
  });

  it("is true when an advanced ancestor gates a plain leaf", () => {
    expect(pathIsAdvanced(entries, ["calibrate", "method"], {})).toBe(true);
  });

  it("is true for an advanced leaf under a plain ancestor", () => {
    expect(pathIsAdvanced(entries, ["filters", "multiply"], {})).toBe(true);
  });

  it("is false when the path doesn't resolve", () => {
    expect(pathIsAdvanced(entries, ["bogus"], {})).toBe(false);
    expect(pathIsAdvanced(entries, [], {})).toBe(false);
  });

  it("ignores the catalog-advanced marks under a pin's wiring fields", () => {
    // The wiring section renders mode/inverted regardless of the global
    // toggle, so a caret there must not flip Show advanced on.
    const pin = {
      key: "pin",
      type: ConfigEntryType.PIN,
      label: "Pin",
      advanced: false,
      config_entries: [
        nested("mode", true, [entry("input", true), entry("pullup", true)]),
        entry("inverted", true),
      ],
    } as ConfigEntry;
    expect(pathIsAdvanced([pin], ["pin", "mode", "input"], {})).toBe(false);
    expect(pathIsAdvanced([pin], ["pin", "mode"], {})).toBe(false);
    expect(pathIsAdvanced([pin], ["pin", "inverted"], {})).toBe(false);
    // An advanced pin entry itself still gates its wiring fields.
    const advancedPin = { ...pin, advanced: true } as ConfigEntry;
    expect(pathIsAdvanced([advancedPin], ["pin", "mode", "input"], {})).toBe(true);
  });

  it("is false for an advanced leaf that already carries a value", () => {
    expect(pathIsAdvanced(entries, ["hide_timestamp"], { hide_timestamp: "5s" })).toBe(
      false
    );
  });

  it("stays true when only an unrelated key carries a value", () => {
    expect(pathIsAdvanced(entries, ["hide_timestamp"], { name: "x" })).toBe(true);
  });

  it("ungates a plain leaf once its advanced ancestor has a value", () => {
    expect(
      pathIsAdvanced(entries, ["calibrate", "method"], { calibrate: { method: "gauss" } })
    ).toBe(false);
    expect(pathIsAdvanced(entries, ["calibrate", "method"], {})).toBe(true);
  });

  it("keeps gating an empty advanced leaf beside a valued sibling", () => {
    expect(
      pathIsAdvanced(entries, ["filters", "multiply"], { filters: { offset: 1 } })
    ).toBe(true);
  });

  it("descends the value scope through list-index segments", () => {
    const pins = {
      ...nested("pins", true, [entry("id", true)]),
      multi_value: true,
    } as ConfigEntry;
    expect(pathIsAdvanced([pins], ["pins", "0", "id"], { pins: [{ id: "x" }] })).toBe(
      false
    );
    expect(pathIsAdvanced([pins], ["pins", "0", "id"], {})).toBe(true);
  });

  it("lets the unit gate override per-entry gating at the top level", () => {
    const a = entry("a", true);
    const gate = (verdict: boolean | undefined) => (key: string) =>
      key === "a" ? verdict : undefined;
    // Gate false: the unit paints inline even though the entry alone gates.
    expect(pathIsAdvanced([a], ["a"], {}, gate(false))).toBe(false);
    // Gate true: the unit is gated even though the entry alone is valued.
    expect(pathIsAdvanced([a], ["a"], { a: "x" }, gate(true))).toBe(true);
    // No verdict: per-entry gating applies.
    expect(pathIsAdvanced([a], ["a"], {}, gate(undefined))).toBe(true);
  });

  it("consults the unit gate for the top-level segment only", () => {
    const wrap = nested("wrap", false, [entry("a", true)]);
    const gate = (key: string) => (key === "a" ? true : undefined);
    // "a" at depth 1 is a plain advanced leaf; its own scope decides.
    expect(pathIsAdvanced([wrap], ["wrap", "a"], { wrap: { a: "set" } }, gate)).toBe(
      false
    );
    expect(pathIsAdvanced([wrap], ["wrap", "a"], {}, gate)).toBe(true);
  });

  it("still short-circuits on a hidden flag under a pin's mode group", () => {
    // The wiring exception suppresses advanced marks, not the hidden
    // walk — a hidden flag never renders, so don't reveal for it.
    const pin = {
      key: "pin",
      type: ConfigEntryType.PIN,
      label: "Pin",
      advanced: true,
      config_entries: [
        nested("mode", true, [
          entry("input", true),
          { ...entry("secret", true), hidden: true } as ConfigEntry,
        ]),
      ],
    } as ConfigEntry;
    expect(pathIsAdvanced([pin], ["pin", "mode", "secret"], {})).toBe(false);
    expect(pathIsAdvanced([pin], ["pin", "mode", "input"], {})).toBe(true);
  });
});
