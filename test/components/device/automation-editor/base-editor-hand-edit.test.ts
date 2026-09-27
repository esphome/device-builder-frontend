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

  it("is released when the reload finds no such section", async () => {
    const { editor } = await mount({
      parseDeviceAutomations: vi.fn().mockResolvedValue([]),
    });
    await editByHand(editor);
    expect(editor.inert).toBe(true);

    editor.reload();
    await settled(editor);

    expect(editor.inert).toBe(false);
  });

  it("stays held when the reload fails, until one reads the tree", async () => {
    const { editor, inner, api } = await mount({
      parseDeviceAutomations: vi
        .fn()
        .mockRejectedValueOnce(new Error("boom"))
        .mockResolvedValue([parsedEdited()]),
    });
    await editByHand(editor);

    editor.reload();
    await settled(editor);
    expect(editor.inert).toBe(true);
    expect(inner._error).not.toBe("");
    inner._engine.withValue({ actions: [] });
    await inner._engine.flushPending();
    expect(api.upsertAutomation).not.toHaveBeenCalled();

    editor.reload();
    await settled(editor);
    expect(editor.inert).toBe(false);
    expect(inner._error).toBe("");
    expect(inner.value.actions).toHaveLength(1);
  });

  it("drops the tree of a section the edit took out of the YAML", async () => {
    const { editor, inner, api } = await mount({
      parseDeviceAutomations: vi.fn().mockResolvedValue([]),
    });
    await editByHand(editor);

    editor.reload();
    await settled(editor);

    expect(inner.value).toBeNull();
    inner._engine.scheduleAutoApply();
    await inner._engine.flushPending();
    expect(api.upsertAutomation).not.toHaveBeenCalled();
  });

  it("keeps the tree of a section the edit left with a parse error", async () => {
    const { editor, inner } = await mount({
      parseDeviceAutomations: vi
        .fn()
        .mockResolvedValue([{ ...parsedEdited(), error: "bad" }]),
    });
    const tree = inner.value;
    await editByHand(editor);

    editor.reload();
    await settled(editor);

    expect(inner.value).toBe(tree);
    expect(inner._parseError.active).toBe(true);
  });

  it("drops the tree when the reload has nothing to ask", async () => {
    const { editor, inner } = await mount();
    await editByHand(editor);
    inner._api = undefined;

    editor.reload();
    await settled(editor);

    expect(editor.inert).toBe(false);
    expect(inner.value).toBeNull();
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

  it("stays held when the YAML was edited again while the reload read it", async () => {
    const first = deferred<ParsedAutomation[]>();
    const { editor, inner, api } = await mount({
      parseDeviceAutomations: vi
        .fn()
        .mockReturnValueOnce(first.promise)
        .mockResolvedValue([parsedEdited()]),
    });
    await editByHand(editor);
    editor.reload();
    editor.yaml = `${EDITED}\n`;
    await editor.updateComplete;

    first.resolve([parsedEdited()]);
    await settled(editor);
    expect(editor.inert).toBe(true);
    inner._engine.withValue({ actions: [] });
    await inner._engine.flushPending();
    expect(api.upsertAutomation).not.toHaveBeenCalled();

    editor.reload();
    await settled(editor);
    expect(editor.inert).toBe(false);
  });

  it("leaves the page without the tree from before the edit, and reads it when it is back", async () => {
    const { editor, inner, api } = await mount({
      parseDeviceAutomations: vi.fn().mockResolvedValue([parsedEdited()]),
    });
    await editByHand(editor);
    const parent = editor.parentNode!;

    editor.remove();
    expect(editor.inert).toBe(false);
    expect(inner.value).toBeNull();

    const d = deferred<ParsedAutomation[]>();
    api.parseDeviceAutomations.mockClear();
    api.parseDeviceAutomations.mockReturnValue(d.promise);
    parent.appendChild(editor);
    await editor.updateComplete;
    expect(editor.inert).toBe(true);
    inner._engine.withValue({ actions: [] });
    await flushMicrotasks(3);
    expect(api.upsertAutomation).not.toHaveBeenCalled();

    d.resolve([parsedEdited()]);
    await settled(editor);
    expect(api.parseDeviceAutomations).toHaveBeenCalledWith("device.yaml", EDITED);
    expect(inner.value.actions).toHaveLength(1);
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

  it("is released when the edit is taken back to the YAML it wrote", async () => {
    const { editor, inner } = await mount();
    const parse = inner._api.parseDeviceAutomations;
    parse.mockClear();
    inner._engine._lastSelfWrittenYaml = YAML;
    await editByHand(editor);
    expect(editor.inert).toBe(true);

    editor.yaml = YAML;
    await editor.updateComplete;
    expect(editor.inert).toBe(false);

    editor.reload();
    await settled(editor);
    expect(parse).not.toHaveBeenCalled();
    expect(editor.inert).toBe(false);
  });

  it.each([
    [
      "the tree",
      (d: ReturnType<typeof deferred<ParsedAutomation[]>>) => d.resolve([parsedEdited()]),
    ],
    [
      "the failure",
      (d: ReturnType<typeof deferred<ParsedAutomation[]>>) => d.reject(new Error("boom")),
    ],
  ])("ignores %s of a reload whose edit was taken back meanwhile", async (_n, land) => {
    const d = deferred<ParsedAutomation[]>();
    const { editor, inner } = await mount({
      parseDeviceAutomations: vi.fn().mockReturnValue(d.promise),
    });
    const tree = inner.value;
    inner._engine._lastSelfWrittenYaml = YAML;
    await editByHand(editor);
    editor.reload();

    editor.yaml = YAML;
    await editor.updateComplete;
    land(d);
    await settled(editor);

    expect(inner.value).toBe(tree);
    expect(inner._error).toBe("");
    expect(editor.inert).toBe(false);
  });

  it("is released by a reload that has nothing to read", async () => {
    const { editor, inner } = await mount();
    await editByHand(editor);
    inner._engine._lastSelfWrittenYaml = EDITED;

    editor.reload();
    await settled(editor);

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

  it("is held while it reads its first tree", async () => {
    const d = deferred<ParsedAutomation[]>();
    const api = makeEditorApi({
      parseDeviceAutomations: vi.fn().mockReturnValue(d.promise),
    });
    const editor = new ESPHomeScriptEditor();
    editor.yaml = EDITED;
    await mountEditor(editor, api, {
      configuration: "device.yaml",
      location: { kind: "script", id: "a" },
    });
    const inner = editor as any;
    expect(api.parseDeviceAutomations).toHaveBeenCalled();
    expect(editor.inert).toBe(true);

    inner._engine.withValue({ actions: [] });
    await flushMicrotasks(3);
    expect(api.upsertAutomation).not.toHaveBeenCalled();

    d.resolve([parsedEdited()]);
    await settled(editor);
    expect(editor.inert).toBe(false);
    expect(inner.value.actions).toHaveLength(1);
  });

  it("stays held when the YAML was edited while it read its first tree", async () => {
    const d = deferred<ParsedAutomation[]>();
    const api = makeEditorApi({
      parseDeviceAutomations: vi
        .fn()
        .mockReturnValueOnce(d.promise)
        .mockResolvedValue([parsedEdited()]),
    });
    const editor = new ESPHomeScriptEditor();
    editor.yaml = YAML;
    await mountEditor(editor, api, {
      configuration: "device.yaml",
      location: { kind: "script", id: "a" },
    });
    const inner = editor as any;
    await editByHand(editor);

    d.resolve([parsedAutomation({ location: { kind: "script", id: "a" } })]);
    await settled(editor);
    expect(inner.value.actions).toHaveLength(0);
    expect(editor.inert).toBe(true);
    inner._engine.withValue({ actions: [] });
    await flushMicrotasks(3);
    expect(api.upsertAutomation).not.toHaveBeenCalled();

    editor.reload();
    await settled(editor);
    expect(editor.inert).toBe(false);
    expect(inner.value.actions).toHaveLength(1);
  });
});
