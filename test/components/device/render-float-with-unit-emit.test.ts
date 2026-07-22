/**
 * Pins the float-with-unit magnitude commit: finite input serializes
 * ``<value><unit>``, clearing still clears, and non-finite input ships
 * verbatim instead of silently clearing the stored value (#1365).
 */
import { describe, expect, it, vi } from "vitest";
import {
  type ConfigEntry,
  ConfigEntryType,
} from "../../../src/api/types/config-entries.js";
import type { RenderCtx } from "../../../src/components/device/config-entry-renderers-shared.js";
import { renderFloatWithUnitField } from "../../../src/components/device/config-entry-renderers/primitives.js";
import { makeConfigEntry } from "../../../src/util/config-entry-defaults.js";
import { findElementBindings, makeRenderCtx } from "./_renderer-fixtures.js";

function fireInput(tpl: unknown, value: string): void {
  const handler = findElementBindings(tpl, "input")[0]["@input"] as (e: unknown) => void;
  handler({ target: { value } });
}

function withUnitEntry(): ConfigEntry {
  return makeConfigEntry({
    key: "frequency",
    type: ConfigEntryType.FLOAT_WITH_UNIT,
    label: "Frequency",
    unit_options: ["Hz", "kHz", "MHz"],
  });
}

function makeCtx(values: Record<string, unknown>): {
  ctx: RenderCtx;
  emitChange: ReturnType<typeof vi.fn>;
} {
  const emitChange = vi.fn();
  const ctx = makeRenderCtx(values, { board: null, overrides: { emitChange } });
  return { ctx, emitChange };
}

describe("renderFloatWithUnitField — magnitude commit", () => {
  it("serializes finite input with the display unit", () => {
    const { ctx, emitChange } = makeCtx({ frequency: "" });
    fireInput(renderFloatWithUnitField(withUnitEntry(), ["frequency"], ctx), "50");
    expect(emitChange).toHaveBeenCalledWith(["frequency"], "50Hz");
  });

  it("keeps the stored value's unit on edit", () => {
    const { ctx, emitChange } = makeCtx({ frequency: "50kHz" });
    fireInput(renderFloatWithUnitField(withUnitEntry(), ["frequency"], ctx), "75");
    expect(emitChange).toHaveBeenCalledWith(["frequency"], "75kHz");
  });

  it("still clears on empty input", () => {
    const { ctx, emitChange } = makeCtx({ frequency: "50kHz" });
    fireInput(renderFloatWithUnitField(withUnitEntry(), ["frequency"], ctx), "");
    expect(emitChange).toHaveBeenCalledWith(["frequency"], "");
  });

  it("ships non-finite input verbatim instead of clearing", () => {
    const { ctx, emitChange } = makeCtx({ frequency: "50kHz" });
    fireInput(renderFloatWithUnitField(withUnitEntry(), ["frequency"], ctx), "1e309");
    expect(emitChange).toHaveBeenCalledWith(["frequency"], "1e309");
  });
});
