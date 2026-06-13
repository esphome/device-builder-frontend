/**
 * @vitest-environment happy-dom
 *
 * The add dialog floats required entries first; an exclusive_group is
 * treated atomically so its members stay contiguous and in order.
 */
import { describe, expect, it } from "vitest";

import type { ConfigEntry } from "../../../src/api/types/config-entries.js";
import { ConfigEntryType } from "../../../src/api/types/config-entries.js";
import { ESPHomeConfigEntryForm } from "../../../src/components/device/config-entry-form.js";
import { makeConfigEntry } from "../../util/_make-config-entry.js";

const float = (entries: ConfigEntry[]): string[] =>
  (
    new ESPHomeConfigEntryForm() as unknown as {
      _floatRequiredFirst(e: ConfigEntry[]): ConfigEntry[];
    }
  )
    ._floatRequiredFirst(entries)
    .map((e) => e.key);

describe("config-entry-form required-first ordering", () => {
  it("floats required entries ahead of optional ones, stably", () => {
    const entries = [
      makeConfigEntry({ key: "opt_a", type: ConfigEntryType.STRING }),
      makeConfigEntry({ key: "req_a", type: ConfigEntryType.STRING, required: true }),
      makeConfigEntry({ key: "opt_b", type: ConfigEntryType.STRING }),
      makeConfigEntry({ key: "req_b", type: ConfigEntryType.STRING, required: true }),
    ];
    expect(float(entries)).toEqual(["req_a", "req_b", "opt_a", "opt_b"]);
  });

  it("keeps a required+optional exclusive_group contiguous and ordered", () => {
    const entries = [
      makeConfigEntry({ key: "opt", type: ConfigEntryType.STRING }),
      makeConfigEntry({
        key: "grp_first",
        type: ConfigEntryType.STRING,
        exclusive_group: "g",
      }),
      makeConfigEntry({
        key: "grp_second",
        type: ConfigEntryType.STRING,
        exclusive_group: "g",
        required: true,
      }),
    ];
    // The group floats as a unit (a member is required) and grp_first
    // stays its lead member, so orderExclusiveGroups folds at the same slot.
    expect(float(entries)).toEqual(["grp_first", "grp_second", "opt"]);
  });
});
