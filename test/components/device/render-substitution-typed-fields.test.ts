/**
 * @vitest-environment happy-dom
 *
 * Pins the leaf dispatch: a typed field holding a ${var} substitution
 * renders as an editable text input, not a number/switch/select (#1391).
 */
import { describe, expect, it } from "vitest";
import {
  type ConfigEntry,
  ConfigEntryType,
} from "../../../src/api/types/config-entries.js";
import { ESPHomeConfigEntryForm } from "../../../src/components/device/config-entry-form.js";
import type { RenderCtx } from "../../../src/components/device/config-entry-renderers-shared.js";
import { makeConfigEntry } from "../../../src/util/config-entry-defaults.js";
import { findElementBindings, makeRenderCtx } from "./_renderer-fixtures.js";

const YAML = ["substitutions:", '  current_res: "0.05"', '  voltage_div: "720"', ""].join(
  "\n"
);

const serialize = (tpl: unknown): string =>
  JSON.stringify(tpl, (k, v) => (k === "_$litType$" ? 0 : v));

/** Drive the form's private leaf dispatch with a one-field ctx rooted at
 *  *value*, so the test exercises the type→renderer choice directly. */
function renderLeaf(entry: ConfigEntry, value: unknown): unknown {
  const form = new ESPHomeConfigEntryForm();
  const ctx: RenderCtx = makeRenderCtx(
    { field: value },
    { board: null, overrides: { sectionKey: "sensor.hlw8012", yaml: YAML } }
  );
  return (
    form as unknown as {
      _renderEntryLeaf(e: ConfigEntry, p: string[], c: RenderCtx): unknown;
    }
  )._renderEntryLeaf(entry, ["field"], ctx);
}

describe("leaf dispatch routes ${var} values to an editable text field (#1391)", () => {
  it("renders a FLOAT ${var} as a text input with the resolution hint", () => {
    const result = renderLeaf(
      makeConfigEntry({ key: "field", type: ConfigEntryType.FLOAT }),
      "${current_res}"
    );
    const inputs = findElementBindings(result, "input");
    expect(inputs).toHaveLength(1);
    expect(inputs[0]["type"]).toBe("text");
    expect(inputs[0][".value"]).toBe("${current_res}");
    const json = serialize(result);
    expect(json).toContain("substitution-note");
    expect(json).toContain("0.05");
  });

  it("keeps a mid-edit partial substitution (${voltage_div) on the text input", () => {
    // Deleting the closing brace must not snap the field back to the number
    // widget (which blanks the partial and reblocks editing) (#1391).
    const result = renderLeaf(
      makeConfigEntry({ key: "field", type: ConfigEntryType.FLOAT }),
      "${voltage_div"
    );
    const inputs = findElementBindings(result, "input");
    expect(inputs[0]["type"]).toBe("text");
    expect(inputs[0][".value"]).toBe("${voltage_div");
  });

  it("leaves a plain FLOAT value on the number input (no fallback, no hint)", () => {
    const result = renderLeaf(
      makeConfigEntry({ key: "field", type: ConfigEntryType.FLOAT }),
      "0.05"
    );
    const inputs = findElementBindings(result, "input");
    expect(inputs[0][".value"]).toBe("0.05");
    // type="number" is static, so it never shows as a "text" binding; proves
    // no text fallback fired.
    expect(inputs[0]["type"]).not.toBe("text");
    expect(serialize(result)).not.toContain("substitution-note");
  });

  it("renders a FLOAT_WITH_UNIT ${var} as text, not a unit picker", () => {
    const result = renderLeaf(
      makeConfigEntry({
        key: "field",
        type: ConfigEntryType.FLOAT_WITH_UNIT,
        unit_options: ["Ω"],
      }),
      "${current_res}"
    );
    expect(findElementBindings(result, "input")[0]["type"]).toBe("text");
    expect(findElementBindings(result, "wa-select")).toHaveLength(0);
  });

  it("renders a BOOLEAN ${var} as text, not a switch", () => {
    const result = renderLeaf(
      makeConfigEntry({ key: "field", type: ConfigEntryType.BOOLEAN }),
      "${enabled}"
    );
    expect(findElementBindings(result, "input")[0][".value"]).toBe("${enabled}");
    expect(findElementBindings(result, "wa-switch")).toHaveLength(0);
  });

  it("renders an options SELECT ${var} as text, not a dropdown", () => {
    const result = renderLeaf(
      makeConfigEntry({
        key: "field",
        type: ConfigEntryType.SELECT,
        options: [
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ],
      }),
      "${mode}"
    );
    expect(findElementBindings(result, "input")[0]["type"]).toBe("text");
    expect(findElementBindings(result, "wa-select")).toHaveLength(0);
  });

  it("keeps a SECURE_STRING ${var} on the masked input and never previews it", () => {
    const result = renderLeaf(
      makeConfigEntry({ key: "field", type: ConfigEntryType.SECURE_STRING }),
      "${voltage_div}"
    );
    expect(findElementBindings(result, "esphome-password-input")).toHaveLength(1);
    const json = serialize(result);
    expect(json).not.toContain("substitution-note");
    expect(json).not.toContain("720");
  });
});
