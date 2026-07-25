/**
 * @vitest-environment happy-dom
 *
 * The editors' ``_canApply`` overrides gate the engine's upsert: an
 * identity-less script / api action never writes, and dropping an
 * override would silently fall back to the base's permissive default.
 */
import { describe, expect, it } from "vitest";

import "./_editor-harness.js";

import type { AutomationLocation } from "../../../../src/api/types/automations.js";
import { ESPHomeApiActionEditor } from "../../../../src/components/device/automation-editor/api-action-editor.js";
import { ESPHomeScriptEditor } from "../../../../src/components/device/automation-editor/script-editor.js";
import { flushMicrotasks } from "../../../_dom.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  type EditorApiMock,
  makeEditorApi,
  mountEditor,
  seedTree,
} from "./_editor-harness.js";

async function mountAndFlush(
  editor: ESPHomeScriptEditor | ESPHomeApiActionEditor,
  api: EditorApiMock,
  location: AutomationLocation
) {
  await mountEditor(editor, api, {
    configuration: "device.yaml",
    location,
    value: seedTree(),
  });
  (editor as any)._engine.withValue({ actions: [] });
  await editor.flushPending();
  await flushMicrotasks(5);
}

const CASES: Array<{
  name: string;
  make: () => ESPHomeScriptEditor | ESPHomeApiActionEditor;
  blocked: AutomationLocation;
  allowed: AutomationLocation;
  sibling: AutomationLocation;
}> = [
  {
    name: "script editor",
    make: () => new ESPHomeScriptEditor(),
    blocked: { kind: "script", id: "" },
    allowed: { kind: "script", id: "my_script" },
    sibling: { kind: "script", id: "other_script" },
  },
  {
    name: "api-action editor",
    make: () => new ESPHomeApiActionEditor(),
    blocked: { kind: "api_action", action_name: "" },
    allowed: { kind: "api_action", action_name: "my_action" },
    sibling: { kind: "api_action", action_name: "other_action" },
  },
];

describe.each(CASES)("$name _canApply wiring", ({ make, blocked, allowed, sibling }) => {
  it("blocks the upsert while the identity is empty", async () => {
    const api = makeEditorApi();
    await mountAndFlush(make(), api, blocked);

    expect(api.upsertAutomation).not.toHaveBeenCalled();
  });

  it("upserts once the identity is set", async () => {
    const api = makeEditorApi();
    await mountAndFlush(make(), api, allowed);

    expect(api.upsertAutomation).toHaveBeenCalled();
  });

  it("a navigator swap to a sibling invalidates the stale value and re-hydrates", async () => {
    const api = makeEditorApi();
    const editor = make();
    await mountAndFlush(editor, api, allowed);
    expect(api.parseDeviceAutomations).not.toHaveBeenCalled();

    (editor as any).location = sibling;
    await editor.updateComplete;
    await flushMicrotasks(5);

    expect((editor as any).value).toBeNull();
    expect(api.parseDeviceAutomations).toHaveBeenCalled();
  });
});
