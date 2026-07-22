/**
 * Pins that both wa-select emit paths (suggestions and strict select)
 * commit through ``coerceValueToEntryType``, so a typed entry modeled
 * as options emits its declared type and the YAML stays bare (#1372).
 */
import { describe, expect, it, vi } from "vitest";
import type { ConfigValueOption } from "../../../src/api/types/config-entries.js";
import { ConfigEntryType } from "../../../src/api/types/config-entries.js";
import { renderSelectField } from "../../../src/components/device/config-entry-renderers/primitives.js";
import { makeEntry, makeRenderCtx } from "./_renderer-fixtures.js";
import { findElementBindings } from "./_renderer-fixtures.js";

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
  const emitChange = vi.fn();
  const entry = makeEntry(type, extra);
  const ctx = makeRenderCtx({ field: "" }, { board: null, overrides: { emitChange } });
  fireChange(renderSelectField(entry, ["field"], ctx), picked);
  return emitChange.mock.calls[0][1];
}

describe("renderSelectField — emits coerce to the entry's type", () => {
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
    expect(
      emitFor(ConfigEntryType.INTEGER, { options: asOptions(["0", "90"]) }, "")
    ).toBe("");
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
