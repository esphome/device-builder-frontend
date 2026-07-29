/** Unit tests for `advancedGated`. */
import { describe, expect, it } from "vitest";

import type { ConfigEntry } from "../../src/api/types/config-entries.js";
import { ConfigEntryType } from "../../src/api/types/config-entries.js";
import { advancedGated } from "../../src/util/material-value.js";

const entry = (key: string, extra: Partial<ConfigEntry> = {}): ConfigEntry =>
  ({ key, type: ConfigEntryType.STRING, label: key, ...extra }) as ConfigEntry;

describe("advancedGated", () => {
  it("gates an advanced entry without a value", () => {
    expect(advancedGated(entry("a", { advanced: true }), {})).toBe(true);
  });

  it("does not gate a valued advanced entry", () => {
    expect(advancedGated(entry("a", { advanced: true }), { a: "x" })).toBe(false);
  });

  it("never gates a plain entry", () => {
    expect(advancedGated(entry("a"), {})).toBe(false);
  });

  it("follows hasMaterialValue into nested children", () => {
    const nested = {
      key: "grp",
      type: ConfigEntryType.NESTED,
      label: "grp",
      advanced: true,
      config_entries: [entry("child")],
    } as ConfigEntry;
    expect(advancedGated(nested, { grp: { child: 1 } })).toBe(false);
    expect(advancedGated(nested, {})).toBe(true);
  });
});
