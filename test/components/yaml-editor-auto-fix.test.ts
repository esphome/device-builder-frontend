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
import type { YamlAutoFix } from "../../src/util/yaml-error-analysis.js";
import { mount } from "../_dom.js";

const viewOf = (el: ESPHomeYamlEditor): EditorView =>
  (el as unknown as { _view: EditorView })._view;

// The reproduction: dash at column 0, properties indented 4 spaces. The fix
// indents line 2 (`- platform`) by 2 so it lines up with its properties.
const BROKEN = "sensor:\n- platform: dht\n    model: DHT11\n";
const FIXED = "sensor:\n  - platform: dht\n    model: DHT11\n";
const FIX: YamlAutoFix = { line: 2, indent: 2, key: "platform", fromIndent: 0 };

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

describe("yaml-editor applyAutoFix (#1884)", () => {
  it("applies when the proposed fix produces clean YAML", async () => {
    const validateYaml = vi.fn(async () => CLEAN);
    const el = await mountEditor(validateYaml);
    const view = viewOf(el);

    expect(await el.applyAutoFix(FIX)).toBe("applied");

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

    await el.applyAutoFix(FIX, confirm);

    expect(confirm).not.toHaveBeenCalled();
    expect(viewOf(el).state.doc.toString()).toBe(FIXED);
  });

  it("asks, then applies, when errors remain and the user confirms", async () => {
    const validateYaml = vi.fn(async () => STILL_INVALID);
    const el = await mountEditor(validateYaml);
    const view = viewOf(el);
    const confirm = vi.fn(async () => true);

    await el.applyAutoFix(FIX, confirm);

    expect(confirm).toHaveBeenCalledOnce();
    expect(view.state.doc.toString()).toBe(FIXED);
  });

  it("asks, then skips, when errors remain and the user declines", async () => {
    const validateYaml = vi.fn(async () => STILL_INVALID);
    const el = await mountEditor(validateYaml);
    const view = viewOf(el);
    const confirm = vi.fn(async () => false);

    expect(await el.applyAutoFix(FIX, confirm)).toBe("declined");

    expect(confirm).toHaveBeenCalledOnce();
    expect(view.state.doc.toString()).toBe(BROKEN);
  });

  it("does not apply over remaining errors when no confirm is supplied", async () => {
    const validateYaml = vi.fn(async () => STILL_INVALID);
    const el = await mountEditor(validateYaml);

    await el.applyAutoFix(FIX);

    expect(viewOf(el).state.doc.toString()).toBe(BROKEN);
  });

  it("propagates a validation failure without applying", async () => {
    const validateYaml = vi.fn(async () => {
      throw new Error("WS down");
    });
    const el = await mountEditor(validateYaml);
    const view = viewOf(el);

    await expect(el.applyAutoFix(FIX)).rejects.toThrow("WS down");
    expect(view.state.doc.toString()).toBe(BROKEN);
  });

  it("no-ops when the target line is no longer the same item (stale banner)", async () => {
    const validateYaml = vi.fn(async () => CLEAN);
    const el = await mountEditor(validateYaml);
    const view = viewOf(el);

    // A fix that points at line 2 but expects a different key.
    expect(await el.applyAutoFix({ ...FIX, key: "uptime" })).toBe("stale");

    expect(view.state.doc.toString()).toBe(BROKEN);
    expect(validateYaml).not.toHaveBeenCalled(); // bailed before validating
  });

  it("no-ops when the item is already indented correctly (stale double-fix)", async () => {
    const validateYaml = vi.fn(async () => CLEAN);
    // Already aligned: the item no longer needs `fix.indent`, so applying it
    // would double-indent. The delta re-check bails before validating.
    const el = await mountEditor(validateYaml, FIXED);
    const view = viewOf(el);

    expect(await el.applyAutoFix(FIX)).toBe("stale");

    expect(view.state.doc.toString()).toBe(FIXED);
    expect(validateYaml).not.toHaveBeenCalled();
  });

  it("applies a negative fix by removing leading spaces (sibling dedent)", async () => {
    const validateYaml = vi.fn(async () => CLEAN);
    const broken =
      "light:\n  - platform: x\n    effects:\n" +
      "      - addressable_twinkle:\n      - flicker:\n       - pulse:\n";
    const fixed =
      "light:\n  - platform: x\n    effects:\n" +
      "      - addressable_twinkle:\n      - flicker:\n      - pulse:\n";
    const el = await mountEditor(validateYaml, broken);
    const view = viewOf(el);

    expect(
      await el.applyAutoFix({ line: 6, indent: -1, key: "pulse", fromIndent: 7 })
    ).toBe("applied");

    expect(view.state.doc.toString()).toBe(fixed);
    expect(validateYaml).toHaveBeenCalledWith("x.yaml", fixed);
    undo(view);
    expect(view.state.doc.toString()).toBe(broken);
  });

  it("no-ops a stale dedent whose line already lines up", async () => {
    const validateYaml = vi.fn(async () => CLEAN);
    const doc =
      "light:\n  - platform: x\n    effects:\n" +
      "      - addressable_twinkle:\n      - flicker:\n      - pulse:\n";
    const el = await mountEditor(validateYaml, doc);

    expect(
      await el.applyAutoFix({ line: 6, indent: -1, key: "pulse", fromIndent: 7 })
    ).toBe("stale");
    expect(validateYaml).not.toHaveBeenCalled();
  });

  it("applies a dash-space fix by inserting the space after the dash", async () => {
    const validateYaml = vi.fn(async () => CLEAN);
    const broken = "switch:\n  -platform: gpio\n    id: accessory_power\n";
    const fixed = "switch:\n  - platform: gpio\n    id: accessory_power\n";
    const el = await mountEditor(validateYaml, broken);
    const view = viewOf(el);

    expect(
      await el.applyAutoFix({
        line: 2,
        indent: 0,
        key: "-platform",
        fromIndent: 2,
        kind: "dash-space",
      })
    ).toBe("applied");

    expect(view.state.doc.toString()).toBe(fixed);
    expect(validateYaml).toHaveBeenCalledWith("x.yaml", fixed);
    undo(view);
    expect(view.state.doc.toString()).toBe(broken);
  });

  it("no-ops a stale dash-space fix whose line was already repaired", async () => {
    const validateYaml = vi.fn(async () => CLEAN);
    const doc = "switch:\n  - platform: gpio\n    id: accessory_power\n";
    const el = await mountEditor(validateYaml, doc);

    expect(
      await el.applyAutoFix({
        line: 2,
        indent: 0,
        key: "-platform",
        fromIndent: 2,
        kind: "dash-space",
      })
    ).toBe("stale");
    expect(validateYaml).not.toHaveBeenCalled();
  });

  it("applies a fix whose diagnosis was anchored on a different line", async () => {
    const validateYaml = vi.fn(async () => CLEAN);
    // The continuation shape: `input: true` dedented out of `mode:`, blamed
    // by the scanner on the deeper `pullup` line below it. The fix targets
    // the `input` line; the guard must accept it on the line's own key +
    // indent, not by re-running the analysis anchored there.
    const broken =
      "binary_sensor:\n  - platform: gpio\n    pin:\n      inverted: true\n" +
      "      mode:\n      input: true\n        pullup: true\n      number: 9\n";
    const fixed =
      "binary_sensor:\n  - platform: gpio\n    pin:\n      inverted: true\n" +
      "      mode:\n        input: true\n        pullup: true\n      number: 9\n";
    const el = await mountEditor(validateYaml, broken);
    const view = viewOf(el);

    expect(
      await el.applyAutoFix({ line: 6, indent: 2, key: "input", fromIndent: 6 })
    ).toBe("applied");

    expect(view.state.doc.toString()).toBe(fixed);
    expect(validateYaml).toHaveBeenCalledWith("x.yaml", fixed);
  });
});
