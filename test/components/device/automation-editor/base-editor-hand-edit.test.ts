/**
 * @vitest-environment happy-dom
 *
 * The reload that follows a YAML edited outside the editor comes up to a
 * second later. Until it has settled the editor is held, so its tree from
 * before the edit cannot be written over it (#1920).
 */
import { describe, expect, it, vi } from "vitest";

import "./_editor-harness.js";

import { deferred, flushMicrotasks } from "../../../_dom.js";
import type { ParsedAutomation } from "../../../../src/api/types/automations.js";
import { ESPHomeScriptEditor } from "../../../../src/components/device/automation-editor/script-editor.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  type EditorApiMock,
  makeEditorApi,
  mountEditor,
  parsedAutomation,
  seedTree,
} from "./_editor-harness.js";

const YAML = "script:\n  - id: a\n    then: []\n";
const EDITED = "script:\n  - id: a\n    then:\n      - logger.log: by hand\n";

const parsedEdited = () =>
  parsedAutomation({
    location: { kind: "script", id: "a" },
    automation: {
      ...seedTree(),
      actions: [{ action_id: "logger.log", params: { format: "by hand" } }],
    },
  });

async function mount(overrides: Partial<EditorApiMock> = {}, addMode = false) {
  const api = makeEditorApi(overrides);
  const editor = new ESPHomeScriptEditor();
  editor.yaml = YAML;
  editor.addMode = addMode;
  await mountEditor(editor, api, {
    configuration: "device.yaml",
    location: { kind: "script", id: "a" },
    value: seedTree(),
  });
  return { editor, inner: editor as any, api };
}

async function editByHand(editor: ESPHomeScriptEditor) {
  editor.yaml = EDITED;
  await editor.updateComplete;
}

async function settled(editor: ESPHomeScriptEditor) {
  await flushMicrotasks(5);
  await editor.updateComplete;
}

describe("an editor whose YAML was edited outside it (#1920)", () => {
  it("is held and writes nothing until the reload has read the tree", async () => {
    const d = deferred<ParsedAutomation[]>();
    const { editor, inner, api } = await mount({
      parseDeviceAutomations: vi.fn().mockReturnValue(d.promise),
    });

    await editByHand(editor);
    expect(editor.inert).toBe(true);
    expect(editor.ariaBusy).toBe("true");

    inner._engine.withValue({ actions: [] });
    await inner._engine.flushPending();
    expect(api.upsertAutomation).not.toHaveBeenCalled();
    expect(editor.dirty).toBe(false);

    editor.reload();
    await settled(editor);
    expect(editor.inert).toBe(true);

    d.resolve([parsedEdited()]);
    await settled(editor);
    expect(editor.inert).toBe(false);
    expect(editor.ariaBusy).toBeNull();
    expect(inner.value.actions).toHaveLength(1);
  });

  it.each([
    ["finds no such section", () => Promise.resolve([])],
    ["fails", () => Promise.reject(new Error("boom"))],
  ])("is released when the reload %s", async (_name, parse) => {
    const { editor } = await mount({
      parseDeviceAutomations: vi.fn().mockImplementation(parse),
    });
    await editByHand(editor);
    expect(editor.inert).toBe(true);

    editor.reload();
    await settled(editor);

    expect(editor.inert).toBe(false);
  });

  it("is released when the reload has nothing to ask", async () => {
    const { editor, inner } = await mount();
    await editByHand(editor);
    inner._api = undefined;

    editor.reload();
    await settled(editor);

    expect(editor.inert).toBe(false);
  });

  it("stays held for a reload that a newer one replaced", async () => {
    const first = deferred<ParsedAutomation[]>();
    const second = deferred<ParsedAutomation[]>();
    const { editor } = await mount({
      parseDeviceAutomations: vi
        .fn()
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise),
    });
    await editByHand(editor);
    editor.reload();
    editor.yaml = `${EDITED}\n`;
    await editor.updateComplete;
    editor.reload();

    first.resolve([parsedEdited()]);
    await settled(editor);
    expect(editor.inert).toBe(true);

    second.resolve([parsedEdited()]);
    await settled(editor);
    expect(editor.inert).toBe(false);
  });

  it("is released when it leaves the page", async () => {
    const { editor } = await mount();
    await editByHand(editor);
    editor.remove();
    expect(editor.inert).toBe(false);
  });

  it("is not held for the YAML it wrote itself", async () => {
    const { editor, inner, api } = await mount({
      upsertAutomation: vi.fn().mockResolvedValue({
        yaml_diff: { fromLine: 3, toLine: 3, replacement: "    then: []" },
      }),
    });
    const drafts: string[] = [];
    editor.addEventListener("yaml-draft", (e) => {
      drafts.push((e as CustomEvent<{ yaml: string }>).detail.yaml);
    });
    inner._engine.withValue({ actions: [] });
    await inner._engine.flushPending();
    expect(api.upsertAutomation).toHaveBeenCalledTimes(1);
    expect(drafts).toHaveLength(1);

    editor.yaml = drafts[0];
    await editor.updateComplete;

    expect(editor.inert).toBe(false);
  });

  it("is not held while an edit of the form is on its way out", async () => {
    const { editor, inner } = await mount();
    inner._engine.withValue({ actions: [] });
    expect(editor.dirty).toBe(true);

    await editByHand(editor);

    expect(editor.inert).toBe(false);
    await inner._engine.flushPending();
  });

  it("is not held in add mode or before it has a tree", async () => {
    const adding = await mount({}, true);
    await editByHand(adding.editor);
    expect(adding.editor.inert).toBe(false);

    const empty = await mount();
    empty.inner.value = null;
    await empty.editor.updateComplete;
    await settled(empty.editor);
    empty.inner.value = null;
    await editByHand(empty.editor);
    expect(empty.editor.inert).toBe(false);
  });
});
