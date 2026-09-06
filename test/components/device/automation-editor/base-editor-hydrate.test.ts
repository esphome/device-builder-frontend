/**
 * @vitest-environment happy-dom
 *
 * A relocation keeps the previous tree on screen read-only until the parse
 * lands, concurrent parses share one round trip, and a superseded parse
 * never overwrites a newer one.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import "./_editor-harness.js";

import { deferred, flushMicrotasks } from "../../../_dom.js";
import type {
  ActionNode,
  ParsedAutomation,
} from "../../../../src/api/types/automations.js";
import { _clearAutomationParseCache } from "../../../../src/components/device/automation-editor/base-editor.js";
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
  afterEach(() => _clearAutomationParseCache());

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
});
