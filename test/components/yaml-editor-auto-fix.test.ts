/**
 * @vitest-environment happy-dom
 *
 * The banner's one-click indentation auto-fix validates the proposed edit
 * before touching the buffer: it applies straight away when the proposed
 * document validates cleanly, and asks first when errors remain. Guarded
 * against a stale banner indenting the wrong item. Issue device-builder#1884.
 */
import { undo, undoDepth } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";

import type { ESPHomeAPI } from "../../src/api/esphome-api.js";
import type { EditorValidateResponse } from "../../src/api/types/editor.js";
import { ESPHomeYamlEditor } from "../../src/components/yaml-editor.js";
import type { YamlAutoFix } from "../../src/util/yaml-lint-backend.js";
import { mount } from "../_dom.js";

const viewOf = (el: ESPHomeYamlEditor): EditorView =>
  (el as unknown as { _view: EditorView })._view;

// The reproduction: dash at column 0, properties indented 4 spaces. The fix
// indents line 2 (`- platform`) by 2 so it lines up with its properties.
const BROKEN = "sensor:\n- platform: dht\n    model: DHT11\n";
const FIXED = "sensor:\n  - platform: dht\n    model: DHT11\n";
const FIX: YamlAutoFix = { line: 2, indent: 2, key: "platform" };

const CLEAN: EditorValidateResponse = { yaml_errors: [], validation_errors: [] };
// Proposed document still has an error after the fix.
const STILL_INVALID: EditorValidateResponse = {
  yaml_errors: [],
  validation_errors: [{ message: "required key not provided", range: {} as never }],
};

async function mountEditor(
  validateYaml: (config: string, content: string) => Promise<EditorValidateResponse>,
  doc: string = BROKEN
): Promise<ESPHomeYamlEditor> {
  const el = new ESPHomeYamlEditor();
  (el as unknown as { _api: ESPHomeAPI })._api = {
    validateYaml,
  } as unknown as ESPHomeAPI;
  el.configuration = "x.yaml";
  el.value = doc;
  await mount(el);
  await el.updateComplete;
  return el;
}

describe("yaml-editor applyIndentFix (#1884)", () => {
  it("applies when the proposed fix produces clean YAML", async () => {
    const validateYaml = vi.fn(async () => CLEAN);
    const el = await mountEditor(validateYaml);
    const view = viewOf(el);

    expect(await el.applyIndentFix(FIX)).toBe("applied");

    expect(view.state.doc.toString()).toBe(FIXED);
    expect(validateYaml).toHaveBeenCalledWith("x.yaml", FIXED);
    // Applied as a real transaction, so the user can undo it.
    expect(undoDepth(view.state)).toBeGreaterThan(0);
    undo(view);
    expect(view.state.doc.toString()).toBe(BROKEN);
  });

  it("does not ask when the proposed document validates cleanly", async () => {
    const validateYaml = vi.fn(async () => CLEAN);
    const el = await mountEditor(validateYaml);
    const confirm = vi.fn(async () => true);

    await el.applyIndentFix(FIX, confirm);

    expect(confirm).not.toHaveBeenCalled();
    expect(viewOf(el).state.doc.toString()).toBe(FIXED);
  });

  it("asks, then applies, when errors remain and the user confirms", async () => {
    const validateYaml = vi.fn(async () => STILL_INVALID);
    const el = await mountEditor(validateYaml);
    const view = viewOf(el);
    const confirm = vi.fn(async () => true);

    await el.applyIndentFix(FIX, confirm);

    expect(confirm).toHaveBeenCalledOnce();
    expect(view.state.doc.toString()).toBe(FIXED);
  });

  it("asks, then skips, when errors remain and the user declines", async () => {
    const validateYaml = vi.fn(async () => STILL_INVALID);
    const el = await mountEditor(validateYaml);
    const view = viewOf(el);
    const confirm = vi.fn(async () => false);

    expect(await el.applyIndentFix(FIX, confirm)).toBe("declined");

    expect(confirm).toHaveBeenCalledOnce();
    expect(view.state.doc.toString()).toBe(BROKEN);
  });

  it("does not apply over remaining errors when no confirm is supplied", async () => {
    const validateYaml = vi.fn(async () => STILL_INVALID);
    const el = await mountEditor(validateYaml);

    await el.applyIndentFix(FIX);

    expect(viewOf(el).state.doc.toString()).toBe(BROKEN);
  });

  it("propagates a validation failure without applying", async () => {
    const validateYaml = vi.fn(async () => {
      throw new Error("WS down");
    });
    const el = await mountEditor(validateYaml);
    const view = viewOf(el);

    await expect(el.applyIndentFix(FIX)).rejects.toThrow("WS down");
    expect(view.state.doc.toString()).toBe(BROKEN);
  });

  it("no-ops when the target line is no longer the same item (stale banner)", async () => {
    const validateYaml = vi.fn(async () => CLEAN);
    const el = await mountEditor(validateYaml);
    const view = viewOf(el);

    // A fix that points at line 2 but expects a different key.
    expect(await el.applyIndentFix({ ...FIX, key: "uptime" })).toBe("stale");

    expect(view.state.doc.toString()).toBe(BROKEN);
    expect(validateYaml).not.toHaveBeenCalled(); // bailed before validating
  });

  it("no-ops when the item is already indented correctly (stale double-fix)", async () => {
    const validateYaml = vi.fn(async () => CLEAN);
    // Already aligned: the item no longer needs `fix.indent`, so applying it
    // would double-indent. The delta re-check bails before validating.
    const el = await mountEditor(validateYaml, FIXED);
    const view = viewOf(el);

    expect(await el.applyIndentFix(FIX)).toBe("stale");

    expect(view.state.doc.toString()).toBe(FIXED);
    expect(validateYaml).not.toHaveBeenCalled();
  });

  it("no-ops when the item is followed by a shallower sibling, not a property", async () => {
    const validateYaml = vi.fn(async () => CLEAN);
    // `- platform: dht` (contentCol 2) followed by a top-level sibling, not a
    // property: the delta re-check must treat that as "no property" (null),
    // not a spurious negative delta, and bail.
    const doc = "sensor:\n- platform: dht\nbinary_sensor:\n  - platform: gpio\n";
    const el = await mountEditor(validateYaml, doc);
    const view = viewOf(el);

    expect(await el.applyIndentFix(FIX)).toBe("stale");

    expect(view.state.doc.toString()).toBe(doc);
    expect(validateYaml).not.toHaveBeenCalled();
  });
});
