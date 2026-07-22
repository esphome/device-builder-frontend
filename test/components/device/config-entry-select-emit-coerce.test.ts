/** Pins that both wa-select emit paths coerce through coerceValueToEntryType (#1372). */
import { describe, expect, it } from "vitest";
import type { ConfigValueOption } from "../../../src/api/types/config-entries.js";
import { ConfigEntryType } from "../../../src/api/types/config-entries.js";
import { renderSelectField } from "../../../src/components/device/config-entry-renderers/primitives.js";
import { findElementBindings, makeEmitCtx, makeEntry } from "./_renderer-fixtures.js";

const asOptions = (values: string[]): ConfigValueOption[] =>
  values.map((v) => ({ value: v, label: v }));

function fireChange(tpl: unknown, value: string): void {
  const handler = findElementBindings(tpl, "wa-select")[0]["@change"] as (
    e: unknown
  ) => void;
  handler({ target: { value } });
}

function emitFor(
  type: ConfigEntryType,
  extra: Record<string, unknown>,
  picked: string
): unknown {
  const entry = makeEntry(type, extra);
  const { ctx, emitChange } = makeEmitCtx({ field: "" });
  fireChange(renderSelectField(entry, ["field"], ctx), picked);
  return emitChange.mock.calls[0][1];
}

describe("renderSelectField — emits values coerced to the entry's type", () => {
  it("strict select: integer options emit numbers, booleans emit booleans", () => {
    expect(
      emitFor(ConfigEntryType.INTEGER, { options: asOptions(["0", "90"]) }, "90")
    ).toBe(90);
    expect(
      emitFor(ConfigEntryType.BOOLEAN, { options: asOptions(["true", "false"]) }, "true")
    ).toBe(true);
  });

  it("strict select: string options and the clearable's empty pass through", () => {
    expect(
      emitFor(
        ConfigEntryType.SELECT,
        { options: asOptions(["energy", "power"]) },
        "energy"
      )
    ).toBe("energy");
    // An empty-value option is what makes the select clearable; prove the
    // clear path is live before firing it.
    const clearable = [...asOptions(["0", "90"]), { value: "", label: "(none)" }];
    const entry = makeEntry(ConfigEntryType.INTEGER, { options: clearable });
    const { ctx, emitChange } = makeEmitCtx({ field: "90" });
    const tpl = renderSelectField(entry, ["field"], ctx);
    expect(findElementBindings(tpl, "wa-select")[0][".withClear"]).toBe(true);
    fireChange(tpl, "");
    expect(emitChange).toHaveBeenCalledWith(["field"], "");
  });

  it("suggestions select: integer suggestions emit numbers", () => {
    expect(emitFor(ConfigEntryType.INTEGER, { suggestions: ["11", "13"] }, "13")).toBe(
      13
    );
    expect(
      emitFor(ConfigEntryType.SELECT, { suggestions: ["fast", "slow"] }, "fast")
    ).toBe("fast");
  });
});
