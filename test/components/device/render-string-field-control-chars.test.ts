/**
 * Pins that ``renderStringField`` reveals control characters in a
 * single-line input as ``\r`` / ``\n`` (a uart.write CRLF payload stays
 * visible) and decodes the escaped form back on edit.
 */
import { describe, expect, it, vi } from "vitest";
import {
  type ConfigEntry,
  ConfigEntryType,
} from "../../../src/api/types/config-entries.js";
import type { RenderCtx } from "../../../src/components/device/config-entry-renderers-shared.js";
import { renderStringField } from "../../../src/components/device/config-entry-renderers-shared.js";
import { makeConfigEntry } from "../../../src/util/config-entry-defaults.js";
import { findElementBindings, makeRenderCtx } from "./_renderer-fixtures.js";

function makeEntry(): ConfigEntry {
  return makeConfigEntry({ key: "data", type: ConfigEntryType.STRING, label: "Data" });
}

function ctxFor(value: string): { ctx: RenderCtx; emitChange: ReturnType<typeof vi.fn> } {
  const emitChange = vi.fn();
  const ctx = makeRenderCtx({ data: value }, { board: null, overrides: { emitChange } });
  return { ctx, emitChange };
}

describe("renderStringField — control characters", () => {
  it("reveals a CRLF payload as \\r\\n in the single-line input", () => {
    const { ctx } = ctxFor("saveConfig\r\n");
    const tpl = renderStringField(makeEntry(), "text", ["data"], ctx);
    const [input] = findElementBindings(tpl, "input");
    expect(input[".value"]).toBe("saveConfig\\r\\n");
  });

  it("decodes the escaped edit back to literal control characters", () => {
    const { ctx, emitChange } = ctxFor("");
    const tpl = renderStringField(makeEntry(), "text", ["data"], ctx);
    const [input] = findElementBindings(tpl, "input");
    const onInput = input["@input"] as (e: Event) => void;
    onInput({ target: { value: "saveConfig\\r\\n" } } as unknown as Event);
    expect(emitChange).toHaveBeenCalledWith(["data"], "saveConfig\r\n");
  });
});
