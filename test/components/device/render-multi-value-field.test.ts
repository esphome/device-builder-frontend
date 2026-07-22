/**
 * Targeted tests for renderMultiValueField numeric handling.
 *
 * INTEGER lists render text rows (0x literals, >2^53 decimals, and
 * ${var} references must display and stay typeable, #1349); FLOAT lists
 * keep number spinners on finite rows. Edits coerce back to numbers so
 * the YAML serializer emits them unquoted; STRING lists keep text
 * inputs and string values.
 */
import { describe, expect, it } from "vitest";
import { ConfigEntryType } from "../../../src/api/types/config-entries.js";
import { renderMultiValueField } from "../../../src/components/device/config-entry-renderers.js";
import { findTemplatesByAnchor } from "../../_lit-template-walker.js";
import { findElementBindings, makeEntry, makeRenderCtx } from "./_renderer-fixtures.js";

function fireInput(binding: Record<string, unknown>, value: string): void {
  (binding["@input"] as (e: Event) => void)({ target: { value } } as never);
}

describe("renderMultiValueField numeric coercion", () => {
  it("renders text inputs and emits numbers for an INTEGER list", () => {
    // Text, not number: mirrors renderIntField (#1349) so 0x literals,
    // >2^53 decimals, and ${var} references display and stay typeable.
    const ctx = makeRenderCtx({ field: [1, 2] });
    const tpl = renderMultiValueField(makeEntry(ConfigEntryType.INTEGER), ["field"], ctx);
    const inputs = findElementBindings(tpl, "input");

    expect(inputs[0].type).toBe("text");

    fireInput(inputs[1], "5");
    expect(ctx.emitChange).toHaveBeenCalledWith(["field"], [1, 5]);
  });

  it("keeps 0x literals and >2^53 decimals verbatim in INTEGER rows", () => {
    const ctx = makeRenderCtx({ field: ["0x10", "9007199254740993"] });
    const tpl = renderMultiValueField(makeEntry(ConfigEntryType.INTEGER), ["field"], ctx);
    const inputs = findElementBindings(tpl, "input");

    expect(inputs[0][".value"]).toBe("0x10");
    fireInput(inputs[0], "0x20");
    expect(ctx.emitChange).toHaveBeenCalledWith(["field"], ["0x20", "9007199254740993"]);

    // Editing the 64-bit row itself commits the string, never a rounded
    // double (the Number.isSafeInteger guard in coerceIntFieldValue).
    expect(inputs[1][".value"]).toBe("9007199254740993");
    fireInput(inputs[1], "18446744073709551615");
    expect(ctx.emitChange).toHaveBeenCalledWith(
      ["field"],
      ["0x10", "18446744073709551615"]
    );
  });

  it("routes INTEGER row edits through the editing buffer", () => {
    const ctx = makeRenderCtx({ field: [42] });
    const tpl = renderMultiValueField(makeEntry(ConfigEntryType.INTEGER), ["field"], ctx);
    const inputs = findElementBindings(tpl, "input");

    fireInput(inputs[0], "0042");
    expect(ctx.setEditingMagnitude).toHaveBeenCalledWith(["field", "0"], "0042");
    expect(ctx.emitChange).toHaveBeenCalledWith(["field"], [42]);

    (inputs[0]["@blur"] as () => void)();
    expect(ctx.clearEditingMagnitude).toHaveBeenCalledWith(["field", "0"]);
  });

  it("shows the edit buffer verbatim while it is set", () => {
    const ctx = makeRenderCtx(
      { field: [42] },
      { overrides: { getEditingMagnitude: () => "0042" } }
    );
    const tpl = renderMultiValueField(makeEntry(ConfigEntryType.INTEGER), ["field"], ctx);
    const inputs = findElementBindings(tpl, "input");

    expect(inputs[0][".value"]).toBe("0042");
  });

  it("invalidates row edit buffers when a row is removed", () => {
    const ctx = makeRenderCtx({ field: [1, 2] });
    const tpl = renderMultiValueField(makeEntry(ConfigEntryType.INTEGER), ["field"], ctx);
    const removeButtons = findElementBindings(tpl, "button");

    (removeButtons[0]["@click"] as () => void)();
    expect(ctx.clearEditingMagnitudesUnder).toHaveBeenCalledWith(["field"]);
    expect(ctx.emitChange).toHaveBeenCalledWith(["field"], [2]);
  });

  it("keeps FLOAT literal rows on the number spinner, junk rows on text", () => {
    const ctx = makeRenderCtx({ field: [1.5, "abc"] });
    const tpl = renderMultiValueField(makeEntry(ConfigEntryType.FLOAT), ["field"], ctx);
    const inputs = findElementBindings(tpl, "input");

    expect(inputs[0].type).toBe("number");
    expect(inputs[1].type).toBe("text");
    expect(inputs[1][".value"]).toBe("abc");

    fireInput(inputs[1], "xyz");
    expect(ctx.emitChange).toHaveBeenCalledWith(["field"], [1.5, "xyz"]);
  });

  it("renders a fresh empty FLOAT row as text so a reference is typeable", () => {
    const ctx = makeRenderCtx({ field: [""] });
    const tpl = renderMultiValueField(makeEntry(ConfigEntryType.FLOAT), ["field"], ctx);
    const inputs = findElementBindings(tpl, "input");

    expect(inputs[0].type).toBe("text");
    fireInput(inputs[0], "${gain}");
    expect(ctx.emitChange).toHaveBeenCalledWith(["field"], ["${gain}"]);
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
  it("renders a FLOAT ${var} row as text while sibling literals stay numeric", () => {
    const ctx = makeRenderCtx({ field: ["${ch}", 5] });
    const tpl = renderMultiValueField(makeEntry(ConfigEntryType.FLOAT), ["field"], ctx);
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

describe("renderMultiValueField per-row errors", () => {
  // #1348: item errors land at ``field.<idx>``; only the offending row is
  // flagged and explained, siblings stay clean. The class binding is
  // mid-attribute (walker skips it by name), so assert on each row
  // template's expression values.
  const rowsOf = (tpl: unknown) => findTemplatesByAnchor(tpl, "multi-row");

  it("flags and explains only the row whose path carries the error", () => {
    const ctx = makeRenderCtx({ field: ["abc", 5] });
    ctx.errorAt = (path: string[]) =>
      path.join(".") === "field.0"
        ? { key: "field.0", code: "validation.not_a_number" }
        : null;
    const tpl = renderMultiValueField(makeEntry(ConfigEntryType.INTEGER), ["field"], ctx);
    const rows = rowsOf(tpl);

    expect(rows).toHaveLength(2);
    expect(rows[0].values).toContain("invalid");
    expect(rows[1].values).not.toContain("invalid");
    expect(JSON.stringify(rows[0].values)).toContain("validation.not_a_number");
  });

  it("a field-level error still paints every row", () => {
    const ctx = makeRenderCtx({ field: [1, 2] });
    ctx.errorAt = (path: string[]) =>
      path.join(".") === "field" ? { key: "field", code: "validation.required" } : null;
    const tpl = renderMultiValueField(makeEntry(ConfigEntryType.INTEGER), ["field"], ctx);
    const rows = rowsOf(tpl);

    expect(rows[0].values).toContain("invalid");
    expect(rows[1].values).toContain("invalid");
  });
});
