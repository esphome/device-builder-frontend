/**
 * Targeted tests for renderMultiValueField numeric handling.
 *
 * INTEGER / FLOAT lists (remote_receiver raw codes via the backend,
 * modbus custom_command, lcd user-characters data) must render number
 * inputs and coerce edits back to numbers, so the YAML serializer emits
 * them unquoted; STRING lists keep text inputs and string values.
 */
import { describe, expect, it } from "vitest";
import { ConfigEntryType } from "../../../src/api/types/config-entries.js";
import { renderMultiValueField } from "../../../src/components/device/config-entry-renderers.js";
import { findElementBindings, makeEntry, makeRenderCtx } from "./_renderer-fixtures.js";

function fireInput(binding: Record<string, unknown>, value: string): void {
  (binding["@input"] as (e: Event) => void)({ target: { value } } as never);
}

describe("renderMultiValueField numeric coercion", () => {
  it("renders number inputs and emits numbers for an INTEGER list", () => {
    const ctx = makeRenderCtx({ field: [1, 2] });
    const tpl = renderMultiValueField(makeEntry(ConfigEntryType.INTEGER), ["field"], ctx);
    const inputs = findElementBindings(tpl, "input");

    expect(inputs[0].type).toBe("number");
    expect(inputs[0].step).toBe("1");

    fireInput(inputs[1], "5");
    expect(ctx.emitChange).toHaveBeenCalledWith(["field"], [1, 5]);
  });

  it("uses step=any for a FLOAT list", () => {
    const ctx = makeRenderCtx({ field: [1.5] });
    const tpl = renderMultiValueField(makeEntry(ConfigEntryType.FLOAT), ["field"], ctx);
    const inputs = findElementBindings(tpl, "input");

    expect(inputs[0].step).toBe("any");
    fireInput(inputs[0], "2.5");
    expect(ctx.emitChange).toHaveBeenCalledWith(["field"], [2.5]);
  });

  it("keeps a cleared numeric row as an empty string, not NaN", () => {
    const ctx = makeRenderCtx({ field: [7] });
    const tpl = renderMultiValueField(makeEntry(ConfigEntryType.INTEGER), ["field"], ctx);
    const inputs = findElementBindings(tpl, "input");

    fireInput(inputs[0], "");
    expect(ctx.emitChange).toHaveBeenCalledWith(["field"], [""]);
  });

  it("keeps text inputs and string values for a STRING list", () => {
    const ctx = makeRenderCtx({ field: ["a"] });
    const tpl = renderMultiValueField(makeEntry(ConfigEntryType.STRING), ["field"], ctx);
    const inputs = findElementBindings(tpl, "input");

    expect(inputs[0].type).toBe("text");
    fireInput(inputs[0], "b");
    expect(ctx.emitChange).toHaveBeenCalledWith(["field"], ["b"]);
  });

  it("keeps text inputs for a hex-display INTEGER list (modbus custom_command)", () => {
    const ctx = makeRenderCtx({ field: [0x76] });
    const entry = makeEntry(ConfigEntryType.INTEGER, { display_format: "hex" });
    const inputs = findElementBindings(
      renderMultiValueField(entry, ["field"], ctx),
      "input"
    );

    // A number input would reject 0x.. and Number("0x76") would corrupt it.
    expect(inputs[0].type).toBe("text");
  });
});

describe("renderMultiValueField numeric substitution rows", () => {
  // esphome/device-builder-frontend#1346: a ${var} item can't drive a number
  // input (the browser blanks it) and Number() on edit clobbered the
  // reference. The row edits as text and round-trips the string.
  it("renders the ${var} row as text while sibling literals stay numeric", () => {
    const ctx = makeRenderCtx({ field: ["${ch}", 5] });
    const tpl = renderMultiValueField(makeEntry(ConfigEntryType.INTEGER), ["field"], ctx);
    const inputs = findElementBindings(tpl, "input");

    expect(inputs[0].type).toBe("text");
    expect(inputs[0][".value"]).toBe("${ch}");
    expect(inputs[1].type).toBe("number");
  });

  it("round-trips the reference string on edit, no Number coercion", () => {
    const ctx = makeRenderCtx({ field: ["${ch}", 5] });
    const tpl = renderMultiValueField(makeEntry(ConfigEntryType.INTEGER), ["field"], ctx);
    const inputs = findElementBindings(tpl, "input");

    fireInput(inputs[0], "${chan}");
    expect(ctx.emitChange).toHaveBeenCalledWith(["field"], ["${chan}", 5]);
  });

  it("sibling literal edits still coerce to numbers", () => {
    const ctx = makeRenderCtx({ field: ["${ch}", 5] });
    const tpl = renderMultiValueField(makeEntry(ConfigEntryType.INTEGER), ["field"], ctx);
    const inputs = findElementBindings(tpl, "input");

    fireInput(inputs[1], "7");
    expect(ctx.emitChange).toHaveBeenCalledWith(["field"], ["${ch}", 7]);
  });
});
