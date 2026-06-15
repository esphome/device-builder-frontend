/**
 * @vitest-environment happy-dom
 *
 * The form shows a reactive banner for each *unsatisfied* constraint group and
 * nothing for a satisfied one — so esp32_rmt_led_strip's timing fields stop
 * prompting "Required" once `chipset` is set.
 */
import { describe, expect, it } from "vitest";

import type {
  ConfigEntry,
  RequiredGroup,
} from "../../../src/api/types/config-entries.js";
import { ConfigEntryType } from "../../../src/api/types/config-entries.js";
import { ESPHomeConfigEntryForm } from "../../../src/components/device/config-entry-form.js";
import type { RenderCtx } from "../../../src/components/device/config-entry-renderers-shared.js";
import { makeConfigEntry } from "../../util/_make-config-entry.js";

const ctx = {
  localize: (key: string, params?: Record<string, unknown>) =>
    params ? `${key}|${params.keys}` : key,
} as unknown as RenderCtx;

const serialize = (tpl: unknown): string =>
  // `nothing` (a symbol) stringifies to undefined — treat it as "no banners".
  JSON.stringify(tpl, (k, v) => (k === "_$litType$" ? 0 : v)) ?? "";

const ENTRIES: ConfigEntry[] = [
  makeConfigEntry({ key: "chipset", type: ConfigEntryType.STRING, label: "Chipset" }),
  makeConfigEntry({ key: "bit0_high", type: ConfigEntryType.STRING, group: "custom" }),
  makeConfigEntry({ key: "bit0_low", type: ConfigEntryType.STRING, group: "custom" }),
  makeConfigEntry({ key: "bit1_high", type: ConfigEntryType.STRING, group: "custom" }),
  makeConfigEntry({ key: "bit1_low", type: ConfigEntryType.STRING, group: "custom" }),
];
const REQUIRED_GROUPS: RequiredGroup[] = [
  { kind: "exactly_one", keys: ["chipset", "bit0_high"] },
];

function banners(values: Record<string, unknown>): string {
  const form = new ESPHomeConfigEntryForm();
  form.entries = ENTRIES;
  form.values = values;
  form.requiredGroups = REQUIRED_GROUPS;
  const out = (
    form as unknown as { _renderConstraintBanners(c: RenderCtx): unknown }
  )._renderConstraintBanners(ctx);
  return serialize(out);
}

describe("config-entry-form constraint banners", () => {
  it("shows no banner once chipset satisfies the exactly_one group", () => {
    const out = banners({ chipset: "SK6812" });
    expect(out).not.toContain("constraint-banner");
  });

  it("prompts for the exactly_one group when nothing is set", () => {
    const out = banners({});
    expect(out).toContain("constraint-banner");
    expect(out).toContain("device.constraint_exactly_one");
    // The all-or-none timing group is empty (0 set) so it stays satisfied.
    expect(out).not.toContain("device.constraint_all_or_none");
  });

  it("prompts the all-or-none group when only some timings are set", () => {
    const out = banners({ bit0_high: "300ns" });
    // exactly_one is now satisfied (one of chipset/bit0_high), but the
    // inclusive timing group is partial.
    expect(out).toContain("device.constraint_all_or_none");
    expect(out).not.toContain("device.constraint_exactly_one");
  });
});
