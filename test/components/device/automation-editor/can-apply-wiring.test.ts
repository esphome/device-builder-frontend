/**
 * @vitest-environment happy-dom
 *
 * The editors' ``_canApply`` overrides gate the engine's upsert: an
 * identity-less script / api action never writes, and dropping an
 * override would silently fall back to the base's permissive default.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/components/device/config-entry-form.js", () => ({}));
vi.mock(
  "../../../../src/components/device/automation-editor/automation-action-list.js",
  () => ({})
);
vi.mock(
  "../../../../src/components/device/automation-editor/callable-params-editor.js",
  () => ({})
);
vi.mock("../../../../src/components/confirm-dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/option/option.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/select/select.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/spinner/spinner.js", () => ({}));
vi.mock("sonner-js", () => ({ default: { error: vi.fn() } }));

import type { ESPHomeAPI } from "../../../../src/api/index.js";
import type {
  AutomationLocation,
  AvailableAutomations,
} from "../../../../src/api/types/automations.js";
import { ESPHomeApiActionEditor } from "../../../../src/components/device/automation-editor/api-action-editor.js";
import { ESPHomeScriptEditor } from "../../../../src/components/device/automation-editor/script-editor.js";
import { flushMicrotasks } from "../../../_dom.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

const slimAvailable = (): AvailableAutomations =>
  ({
    triggers: [],
    actions: [],
    conditions: [],
    scripts: [],
    devices: [],
  }) as unknown as AvailableAutomations;

const makeApi = () => ({
  getAvailableAutomations: vi.fn().mockResolvedValue(slimAvailable()),
  getAutomationBodies: vi.fn().mockResolvedValue({}),
  parseDeviceAutomations: vi.fn().mockResolvedValue([]),
  upsertAutomation: vi.fn().mockResolvedValue({
    yaml_diff: { fromLine: 0, toLine: 0, replacement: "" },
  }),
  updateConfig: vi.fn().mockResolvedValue(undefined),
});

async function mountAndFlush(
  editor: ESPHomeScriptEditor | ESPHomeApiActionEditor,
  api: ReturnType<typeof makeApi>,
  location: AutomationLocation
) {
  (editor as any)._api = api as unknown as ESPHomeAPI;
  editor.configuration = "device.yaml";
  (editor as any).location = location;
  (editor as any).value = { trigger_id: null, trigger_params: {}, actions: [] };
  document.body.appendChild(editor);
  await editor.updateComplete;
  await flushMicrotasks(5);
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
    const api = makeApi();
    await mountAndFlush(make(), api, blocked);

    expect(api.upsertAutomation).not.toHaveBeenCalled();
  });

  it("upserts once the identity is set", async () => {
    const api = makeApi();
    await mountAndFlush(make(), api, allowed);

    expect(api.upsertAutomation).toHaveBeenCalled();
  });

  it("a navigator swap to a sibling invalidates the stale value and re-hydrates", async () => {
    const api = makeApi();
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
