/**
 * @vitest-environment happy-dom
 *
 * A relocation keeps the previous tree on screen read-only until the parse
 * lands, concurrent parses share one round trip, and a superseded parse
 * never overwrites a newer one.
 */
import { describe, expect, it, vi } from "vitest";

import "./_editor-harness.js";

import { deferred, flushMicrotasks } from "../../../_dom.js";
import type {
  ActionNode,
  ParsedAutomation,
} from "../../../../src/api/types/automations.js";
import { ESPHomeScriptEditor } from "../../../../src/components/device/automation-editor/script-editor.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  type EditorApiMock,
  makeEditorApi,
  mountEditor,
  parsedAutomation,
  seedTree,
} from "./_editor-harness.js";

const parsedScript = (
  id: string,
  actions: ActionNode[] = [{ action_id: "logger.log", params: {} }]
) =>
  parsedAutomation({
    location: { kind: "script", id },
    label: id,
    automation: { ...seedTree(), actions },
  });

async function mountAt(id: string, parse: ReturnType<typeof vi.fn>) {
  const api = makeEditorApi({
    parseDeviceAutomations: parse as EditorApiMock["parseDeviceAutomations"],
  });
  const editor = new ESPHomeScriptEditor();
  await mountEditor(editor, api, {
    configuration: "device.yaml",
    location: { kind: "script", id },
    value: seedTree(),
  });
  return { editor, api };
}

describe("base editor relocation hydrate", () => {
  it("keeps the previous tree read-only until the parse lands", async () => {
    const d = deferred<ParsedAutomation[]>();
    const parse = vi.fn().mockReturnValue(d.promise);
    const { editor, api } = await mountAt("a", parse);
    const previous = (editor as any).value;

    (editor as any).location = { kind: "script", id: "b" };
    await editor.updateComplete;
    await flushMicrotasks(3);
    expect((editor as any).value).toBe(previous);
    expect((editor as any)._hydrating).toBe(true);
    expect(editor.inert).toBe(true);
    expect(parse).toHaveBeenCalledTimes(1);

    // Edits on the stale tree are ignored.
    (editor as any)._engine.withValue({ actions: [] });
    await flushMicrotasks(3);
    expect(api.upsertAutomation).not.toHaveBeenCalled();

    d.resolve([parsedScript("b")]);
    await flushMicrotasks(5);
    await editor.updateComplete;
    expect((editor as any)._hydrating).toBe(false);
    expect(editor.inert).toBe(false);
    expect((editor as any).value.actions).toHaveLength(1);
  });

  it("comes back editable after a detach mid-hydrate", async () => {
    const d = deferred<ParsedAutomation[]>();
    const parse = vi.fn().mockReturnValue(d.promise);
    const { editor } = await mountAt("a", parse);
    (editor as any).location = { kind: "script", id: "b" };
    await editor.updateComplete;
    expect(editor.inert).toBe(true);
    editor.remove();
    expect(editor.inert).toBe(false);
    expect(editor.ariaBusy).toBeNull();
    expect((editor as any)._hydrating).toBe(false);
    expect((editor as any).value).toBeNull();
  });

  it("drops the tree and the hold when a relocation cannot be parsed", async () => {
    const parse = vi.fn();
    const { editor } = await mountAt("a", parse);
    (editor as any)._api = undefined;
    (editor as any).location = { kind: "script", id: "b" };
    await editor.updateComplete;
    await flushMicrotasks(3);
    expect(parse).not.toHaveBeenCalled();
    expect((editor as any)._hydrating).toBe(false);
    expect((editor as any).value).toBeNull();
  });

  it("drops the previous tree when the new location has no parse", async () => {
    const parse = vi.fn().mockResolvedValue([]);
    const { editor } = await mountAt("a", parse);
    (editor as any).location = { kind: "script", id: "b" };
    await editor.updateComplete;
    await flushMicrotasks(5);
    expect((editor as any).value).toBeNull();
    expect((editor as any)._hydrating).toBe(false);
  });

  it("shares one parse across concurrent hydrates and ignores a superseded one", async () => {
    const first = deferred<ParsedAutomation[]>();
    const second = deferred<ParsedAutomation[]>();
    const parse = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { editor } = await mountAt("a", parse);

    (editor as any).location = { kind: "script", id: "b" };
    await editor.updateComplete;
    editor.reload();
    await flushMicrotasks(3);
    // Same configuration and yaml while in flight: one round trip.
    expect(parse).toHaveBeenCalledTimes(1);

    // A yaml change issues a new parse; the older response must not win.
    first.resolve([parsedScript("b")]);
    await flushMicrotasks(5);
    (editor as any).yaml = "script:\n  - id: b\n";
    editor.reload();
    await flushMicrotasks(3);
    expect(parse).toHaveBeenCalledTimes(2);
    second.resolve([parsedScript("b", [])]);
    await flushMicrotasks(5);
    expect((editor as any).value.actions).toHaveLength(0);
  });

  const actionList = (editor: ESPHomeScriptEditor) =>
    editor.shadowRoot!.querySelector("esphome-automation-action-list");

  it("remounts its body once the parent's other automation has landed", async () => {
    const d = deferred<ParsedAutomation[]>();
    const { editor } = await mountAt("a", vi.fn().mockReturnValue(d.promise));
    const before = actionList(editor);
    expect(before).not.toBeNull();

    (editor as any).location = { kind: "script", id: "b" };
    await editor.updateComplete;
    await flushMicrotasks(3);
    // The previous tree is still on screen, so its rows stay mounted.
    expect(actionList(editor)).toBe(before);

    d.resolve([parsedScript("b")]);
    await flushMicrotasks(5);
    await editor.updateComplete;
    expect(actionList(editor)).not.toBe(before);
  });

  it("collapses Show advanced settings once the other automation has landed", async () => {
    const d = deferred<ParsedAutomation[]>();
    const { editor } = await mountAt("a", vi.fn().mockReturnValue(d.promise));
    (editor as any)._onAdvancedToggle(
      new CustomEvent("advanced-toggle", { detail: { show: true } })
    );

    (editor as any).location = { kind: "script", id: "b" };
    await editor.updateComplete;
    await flushMicrotasks(3);
    expect((editor as any)._showAdvanced).toBe(true);

    d.resolve([parsedScript("b")]);
    await flushMicrotasks(5);
    await editor.updateComplete;
    expect((editor as any)._showAdvanced).toBe(false);
  });

  it("keeps Show advanced settings through a re-parse of the same automation", async () => {
    const parse = vi.fn().mockResolvedValue([parsedScript("a")]);
    const { editor } = await mountAt("a", parse);
    (editor as any)._showAdvanced = true;

    (editor as any).yaml = "script:\n  - id: a\n";
    editor.reload();
    await flushMicrotasks(5);
    await editor.updateComplete;

    expect(parse).toHaveBeenCalled();
    expect((editor as any)._showAdvanced).toBe(true);
  });

  it("keeps its body through a re-parse of the same automation", async () => {
    const parse = vi.fn().mockResolvedValue([parsedScript("a")]);
    const { editor } = await mountAt("a", parse);
    const before = actionList(editor);

    (editor as any).yaml = "script:\n  - id: a\n";
    editor.reload();
    await flushMicrotasks(5);
    await editor.updateComplete;

    expect(parse).toHaveBeenCalled();
    expect(actionList(editor)).toBe(before);
  });

  describe("what the editor tells the forms under it", () => {
    const reads = (editor: ESPHomeScriptEditor): number => (editor as any)._valuesRead;
    const EDITED = "script:\n  - id: a # by hand\n";

    async function outsideEdit(editor: ESPHomeScriptEditor, yaml: string) {
      (editor as any).yaml = yaml;
      await editor.updateComplete;
    }

    async function reloaded(editor: ESPHomeScriptEditor) {
      editor.reload();
      await flushMicrotasks(5);
      await editor.updateComplete;
    }

    async function mounted() {
      const parse = vi.fn().mockResolvedValue([parsedScript("a")]);
      const { editor } = await mountAt("a", parse);
      return { editor, before: reads(editor) };
    }

    it("counts a YAML edited outside the editor, and again the tree read from it", async () => {
      const { editor, before } = await mounted();

      await outsideEdit(editor, EDITED);
      expect(reads(editor)).toBe(before + 1);

      await reloaded(editor);
      expect(reads(editor)).toBe(before + 2);
    });

    it("counts a burst of outside edits once, until the tree is read", async () => {
      const { editor, before } = await mounted();

      await outsideEdit(editor, EDITED);
      await outsideEdit(editor, `${EDITED}# more\n`);
      await outsideEdit(editor, `${EDITED}# and more\n`);
      expect(reads(editor)).toBe(before + 1);

      await reloaded(editor);
      await outsideEdit(editor, EDITED);
      expect(reads(editor)).toBe(before + 3);
    });

    it("counts the read after an outside edit although the editor wrote while it waited", async () => {
      const d = deferred<ParsedAutomation[]>();
      const parse = vi.fn().mockResolvedValueOnce([parsedScript("a")]);
      const { editor } = await mountAt("a", parse);
      parse.mockReturnValue(d.promise);
      const before = reads(editor);
      await outsideEdit(editor, EDITED);
      editor.reload();
      await flushMicrotasks(3);

      // A change in the form while the parse is out makes the YAML its own.
      (editor as any)._engine._lastSelfWrittenYaml = EDITED;
      d.resolve([parsedScript("a")]);
      await flushMicrotasks(5);
      await editor.updateComplete;

      expect(reads(editor)).toBe(before + 2);
    });

    it("does not count the YAML the editor wrote itself", async () => {
      const { editor, before } = await mounted();

      (editor as any)._engine._lastSelfWrittenYaml = EDITED;
      await outsideEdit(editor, EDITED);
      await reloaded(editor);
      expect(reads(editor)).toBe(before);

      // The same steps count for a YAML it did not write.
      await outsideEdit(editor, `${EDITED}# by hand\n`);
      expect(reads(editor)).toBe(before + 1);
    });

    it("keeps the caret target it had while the tree shown is from before the edit", async () => {
      const { editor } = await mounted();
      const focus = () => (editor as any)._currentFocus();
      (editor as any).focusYamlPath = ["script", 0, "mode"];
      await editor.updateComplete;
      expect(focus()).toEqual({ node: [], field: ["mode"] });

      // The caret moves with the edit; the old tree is not asked where to.
      await outsideEdit(editor, EDITED);
      (editor as any).focusYamlPath = ["script", 0, "max_runs"];
      await editor.updateComplete;
      expect(focus()).toEqual({ node: [], field: ["mode"] });

      await reloaded(editor);
      expect(focus()).toEqual({ node: [], field: ["max_runs"] });
    });

    it("follows the caret again after a detach before the reload", async () => {
      const { editor, before } = await mounted();
      await outsideEdit(editor, EDITED);

      const parent = editor.parentNode!;
      editor.remove();
      parent.appendChild(editor);
      await editor.updateComplete;

      expect((editor as any)._stale).toBe(false);
      // And the next outside edit counts again.
      await outsideEdit(editor, `${EDITED}# more\n`);
      expect(reads(editor)).toBeGreaterThan(before + 1);
    });

    it("follows the caret again when the reload has nothing to read", async () => {
      const { editor } = await mounted();
      const focus = () => (editor as any)._currentFocus();
      (editor as any).focusYamlPath = ["script", 0, "mode"];
      await outsideEdit(editor, EDITED);
      (editor as any).focusYamlPath = ["script", 0, "max_runs"];

      // The editor wrote in between, so the reload returns early.
      (editor as any)._engine._lastSelfWrittenYaml = EDITED;
      await reloaded(editor);

      expect(focus()).toEqual({ node: [], field: ["max_runs"] });
    });
  });
});
