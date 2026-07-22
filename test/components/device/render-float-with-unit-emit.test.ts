/**
 * Pins the float-with-unit magnitude commit: finite input serializes
 * ``<value><unit>``, clearing still clears, and non-finite input ships
 * verbatim instead of silently clearing the stored value (#1365).
 */
import { describe, expect, it } from "vitest";
import {
  type ConfigEntry,
  ConfigEntryType,
} from "../../../src/api/types/config-entries.js";
import { renderFloatWithUnitField } from "../../../src/components/device/config-entry-renderers/primitives.js";
import { makeConfigEntry } from "../../../src/util/config-entry-defaults.js";
import { fireInput, makeEmitCtx } from "./_renderer-fixtures.js";

function withUnitEntry(): ConfigEntry {
  return makeConfigEntry({
    key: "frequency",
    type: ConfigEntryType.FLOAT_WITH_UNIT,
    label: "Frequency",
    unit_options: ["Hz", "kHz", "MHz"],
  });
}

describe("renderFloatWithUnitField — magnitude commit", () => {
  it("serializes finite input with the display unit", () => {
    const { ctx, emitChange } = makeEmitCtx({ frequency: "" });
    fireInput(renderFloatWithUnitField(withUnitEntry(), ["frequency"], ctx), "50");
    expect(emitChange).toHaveBeenCalledWith(["frequency"], "50Hz");
  });

  it("keeps the stored value's unit on edit", () => {
    const { ctx, emitChange } = makeEmitCtx({ frequency: "50kHz" });
    fireInput(renderFloatWithUnitField(withUnitEntry(), ["frequency"], ctx), "75");
    expect(emitChange).toHaveBeenCalledWith(["frequency"], "75kHz");
  });

  it("still clears on empty input", () => {
    const { ctx, emitChange } = makeEmitCtx({ frequency: "50kHz" });
    fireInput(renderFloatWithUnitField(withUnitEntry(), ["frequency"], ctx), "");
    expect(emitChange).toHaveBeenCalledWith(["frequency"], "");
  });

  it("ships non-finite input verbatim instead of clearing", () => {
    const { ctx, emitChange } = makeEmitCtx({ frequency: "50kHz" });
    fireInput(renderFloatWithUnitField(withUnitEntry(), ["frequency"], ctx), "1e309");
    expect(emitChange).toHaveBeenCalledWith(["frequency"], "1e309");
  });
});
