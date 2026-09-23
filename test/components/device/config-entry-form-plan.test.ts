/** Unit tests for the render plan's derived decisions. */
import { describe, expect, it } from "vitest";

import type {
  ConfigEntry,
  RequiredGroup,
} from "../../../src/api/types/config-entries.js";
import { ConfigEntryType } from "../../../src/api/types/config-entries.js";
import {
  buildFormRenderPlan,
  unitAdvancedGate,
} from "../../../src/components/device/config-entry-form-plan.js";
import { makeConfigEntry, makeNestedEntry } from "../../util/_make-config-entry.js";

const entry = (key: string, extra: Partial<ConfigEntry> = {}): ConfigEntry =>
  makeConfigEntry({ key, type: ConfigEntryType.STRING, label: key, ...extra });

describe("unitAdvancedGate", () => {
  it("gates a constraint cluster only while every member is advanced and unvalued", () => {
    const entries = [
      entry("a", { advanced: true, group: "grp" }),
      entry("b", { advanced: true, group: "grp" }),
      entry("plain"),
    ];
    expect(unitAdvancedGate(entries, [], {})("b")).toBe(true);
    expect(unitAdvancedGate(entries, [], { a: "set" })("b")).toBe(false);
    expect(unitAdvancedGate(entries, [], {})("plain")).toBeUndefined();
  });

  it("does not gate a mixed cluster — it renders in the basic bucket", () => {
    const entries = [
      entry("a", { group: "grp" }),
      entry("b", { advanced: true, group: "grp" }),
    ];
    expect(unitAdvancedGate(entries, [], {})("b")).toBe(false);
  });

  it("answers for every exclusive-group member, first included", () => {
    // The first member's mapping must see later joiners of the group.
    const entries = [
      entry("first", { advanced: true, exclusive_group: "g" }),
      entry("second", { advanced: true, exclusive_group: "g" }),
    ];
    expect(unitAdvancedGate(entries, [], { second: "set" })("first")).toBe(false);
    expect(unitAdvancedGate(entries, [], {})("first")).toBe(true);
    expect(unitAdvancedGate(entries, [], {})("second")).toBe(true);
  });
});

describe("buildFormRenderPlan unmet constraints", () => {
  const opts = { requiredOnly: false, showAdvanced: false };
  const plan = (
    entries: ConfigEntry[],
    values: Record<string, unknown>,
    groups: RequiredGroup[]
  ) => buildFormRenderPlan(entries, values, groups, opts);

  it("reports an unclustered group as a banner, actionable while a painted member is unlocked", () => {
    const entries = [
      makeConfigEntry({ key: "ssid", locked: true }),
      makeConfigEntry({ key: "networks" }),
    ];
    const groups: RequiredGroup[] = [
      { kind: "at_least_one", keys: ["ssid", "networks"] },
    ];
    expect(plan(entries, {}, groups).unmet).toEqual([
      {
        kind: "at_least_one",
        keys: ["ssid", "networks"],
        source: "banner",
        actionable: true,
      },
    ]);
    const locked = entries.map((e) => ({ ...e, locked: true }));
    expect(plan(locked, {}, groups).unmet[0].actionable).toBe(false);
    expect(plan(entries, { ssid: "home" }, groups).unmet).toEqual([]);
  });

  it("reports an unmet cluster box through its header", () => {
    const entries = [
      makeConfigEntry({ key: "cert", group: "tls" }),
      makeConfigEntry({ key: "key", group: "tls" }),
    ];
    expect(plan(entries, { cert: "a.pem" }, []).unmet).toEqual([
      { kind: "all_or_none", keys: ["cert", "key"], source: "cluster", actionable: true },
    ]);
    expect(plan(entries, {}, []).unmet).toEqual([]);
  });

  it("leaves a radio of leaves to its forced choice but reports its box fallback", () => {
    const entries = [
      makeConfigEntry({ key: "identity" }),
      makeConfigEntry({ key: "cert", group: "tls" }),
      makeConfigEntry({ key: "key", group: "tls" }),
    ];
    const groups: RequiredGroup[] = [{ kind: "exactly_one", keys: ["identity", "cert"] }];
    const radio = plan(entries, {}, groups);
    expect(radio.clusters[0].mode).toBe("radio");
    expect(radio.unmet).toEqual([]);
    const oneSide = plan(
      entries.map((e) => (e.key === "identity" ? { ...e, hidden: true } : e)),
      {},
      groups
    );
    expect(oneSide.clusters[0].mode).toBe("box");
    expect(oneSide.unmet).toEqual([
      {
        kind: "exactly_one",
        keys: ["identity", "cert"],
        source: "cluster",
        actionable: true,
      },
    ]);
  });

  it("reports a radio with a block side, whose switch still has to be set", () => {
    const block = (key: string, group?: string) =>
      ({
        ...makeNestedEntry(key, [makeConfigEntry({ key: "rate", default_value: "1" })]),
        group,
      }) as ConfigEntry;
    const entries = [block("fan"), block("pwm", "out"), block("dac", "out")];
    const groups: RequiredGroup[] = [{ kind: "exactly_one", keys: ["fan", "pwm"] }];
    expect(plan(entries, {}, groups).unmet.map((c) => c.source)).toEqual(["cluster"]);
  });

  it("paints nothing for a cluster whose members are all gated off", () => {
    const entries = [
      makeConfigEntry({ key: "a", group: "g", hidden: true }),
      makeConfigEntry({ key: "b", group: "g", hidden: true }),
    ];
    const out = plan(entries, { a: "x" }, []);
    expect(out.clusters[0].mode).toBe("box");
    expect(out.clusters[0].painted.map((m) => m.key)).toEqual(["a"]);
    expect(plan(entries, {}, []).clusters[0].mode).toBe("none");
  });

  it("does not count an option behind a pinned exclusive group as actionable", () => {
    const entries = [
      makeConfigEntry({ key: "i2c", exclusive_group: "bus", locked: true }),
      makeConfigEntry({ key: "spi", exclusive_group: "bus" }),
    ];
    const groups: RequiredGroup[] = [{ kind: "exactly_one", keys: ["i2c", "spi"] }];
    const out = plan(entries, {}, groups);
    expect([...out.settable.keys()]).toEqual([]);
    expect(out.unmet).toEqual([
      { kind: "exactly_one", keys: ["i2c", "spi"], source: "banner", actionable: false },
    ]);
  });

  it("judges a cluster by the keys of its unmet rule, not every painted member", () => {
    // An editable identity cannot complete the locked, half-set pair.
    const entries = [
      makeConfigEntry({ key: "identity" }),
      makeConfigEntry({ key: "cert", group: "tls", locked: true }),
      makeConfigEntry({ key: "key", group: "tls", locked: true }),
    ];
    const groups: RequiredGroup[] = [
      { kind: "at_least_one", keys: ["identity", "cert"] },
    ];
    expect(plan(entries, { cert: "a.pem" }, groups).unmet).toEqual([
      {
        kind: "all_or_none",
        keys: ["cert", "key"],
        source: "cluster",
        actionable: false,
      },
    ]);
  });
});
