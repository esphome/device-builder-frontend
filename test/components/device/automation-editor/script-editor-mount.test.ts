/**
 * @vitest-environment happy-dom
 *
 * Mount test for script-editor.ts catalog hydration (#1286). Actions
 * inside a script block must arrive with config_entries hydrated, or
 * every action renders fieldless. Heavy children (config-entry-form ->
 * CodeMirror, the action list) are no-op mocked so the editor itself
 * can construct in a happy-dom window.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/components/device/config-entry-form.js", () => ({}));
vi.mock(
  "../../../../src/components/device/automation-editor/automation-action-list.js",
  () => ({})
);
vi.mock(
  "../../../../src/components/device/automation-editor/callable-params-editor.js",
  () => ({})
);
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/option/option.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/select/select.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/spinner/spinner.js", () => ({}));
vi.mock("sonner-js", () => ({ default: { error: vi.fn() } }));

import toast from "sonner-js";
import type { ESPHomeAPI } from "../../../../src/api/index.js";
import type { AvailableAutomations } from "../../../../src/api/types/automations.js";
import { ESPHomeScriptEditor } from "../../../../src/components/device/automation-editor/script-editor.js";
import { _clearAutomationBodyCache } from "../../../../src/util/automation-body-cache.js";
import { flushMicrotasks } from "../../../_dom.js";

const slimWithLoggerAction = (): AvailableAutomations =>
  ({
    triggers: [],
    actions: [{ id: "logger.log", config_entries: [] }],
    conditions: [],
    scripts: [],
    devices: [],
  }) as unknown as AvailableAutomations;

const loggerBodies = () => ({
  "actions/logger.log": {
    id: "logger.log",
    config_entries: [{ key: "format", type: "string", label: "Format", required: true }],
  },
});

async function mountEditor(
  api: ESPHomeAPI,
  configuration?: string,
  props: object = {}
): Promise<ESPHomeScriptEditor> {
  const editor = new ESPHomeScriptEditor();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (editor as any)._api = api;
  if (configuration !== undefined) editor.configuration = configuration;
  Object.assign(editor, props);
  document.body.appendChild(editor);
  await editor.updateComplete;
  await flushMicrotasks(30);
  return editor;
}

describe("script-editor action-catalog hydration (#1286)", () => {
  beforeEach(() => {
    _clearAutomationBodyCache();
    vi.mocked(toast.error).mockClear();
  });

  it("hydrates action config_entries so the form renders", async () => {
    const getAvailableAutomations = vi.fn().mockResolvedValue(slimWithLoggerAction());
    const getAutomationBodies = vi.fn().mockResolvedValue(loggerBodies());
    const api = { getAvailableAutomations, getAutomationBodies } as unknown as ESPHomeAPI;

    const editor = await mountEditor(api, "device.yaml");

    expect(getAutomationBodies).toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const actions = (editor as any)._available.actions as AvailableAutomations["actions"];
    expect(actions[0].config_entries.length).toBeGreaterThan(0);
    // Fully-hydrated catalog -> no partial-hydration toast.
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("does not load without a configuration", async () => {
    const getAvailableAutomations = vi.fn().mockResolvedValue(slimWithLoggerAction());
    const getAutomationBodies = vi.fn().mockResolvedValue({});
    const api = { getAvailableAutomations, getAutomationBodies } as unknown as ESPHomeAPI;

    await mountEditor(api);

    expect(getAvailableAutomations).not.toHaveBeenCalled();
    expect(getAutomationBodies).not.toHaveBeenCalled();
  });

  it("resolves a cursor path into the action list's focus target", async () => {
    const getAvailableAutomations = vi.fn().mockResolvedValue(slimWithLoggerAction());
    const getAutomationBodies = vi.fn().mockResolvedValue(loggerBodies());
    const api = { getAvailableAutomations, getAutomationBodies } as unknown as ESPHomeAPI;

    const editor = await mountEditor(api, "device.yaml", {
      location: { kind: "script", id: "my_script" },
      value: {
        trigger_id: null,
        trigger_params: { id: "my_script" },
        actions: [{ action_id: "logger.log", params: {}, children: {}, conditions: [] }],
      },
      focusYamlPath: ["script", 0, "then", 0, "logger.log", "format"],
    });

    const list = editor.shadowRoot!.querySelector("esphome-automation-action-list");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((list as any).focusTarget).toEqual({ node: [0], field: ["format"] });
  });

  it("routes an entry-param cursor path to the config form", async () => {
    const getAvailableAutomations = vi.fn().mockResolvedValue(slimWithLoggerAction());
    const getAutomationBodies = vi.fn().mockResolvedValue({});
    const api = { getAvailableAutomations, getAutomationBodies } as unknown as ESPHomeAPI;

    const editor = await mountEditor(api, "device.yaml", {
      location: { kind: "script", id: "my_script" },
      value: { trigger_id: null, trigger_params: { id: "my_script" }, actions: [] },
      focusYamlPath: ["script", 0, "mode"],
      _scriptComponent: {
        config_entries: [
          { key: "id", type: "string", label: "ID" },
          { key: "mode", type: "enum", label: "Mode" },
        ],
      },
    });

    const form = editor.shadowRoot!.querySelector("esphome-config-entry-form");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((form as any).focusFieldPath).toEqual(["mode"]);
  });

  it("reveals the advanced-gated parameters block for a parameter target", async () => {
    const getAvailableAutomations = vi.fn().mockResolvedValue(slimWithLoggerAction());
    const getAutomationBodies = vi.fn().mockResolvedValue({});
    const api = { getAvailableAutomations, getAutomationBodies } as unknown as ESPHomeAPI;

    const editor = await mountEditor(api, "device.yaml", {
      location: { kind: "script", id: "my_script" },
      value: {
        trigger_id: null,
        trigger_params: { id: "my_script", parameters: { pin: "int" } },
        actions: [],
      },
      focusYamlPath: ["script", 0, "parameters", "pin"],
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((editor as any)._showAdvanced).toBe(true);
    const params = editor.shadowRoot!.querySelector("esphome-callable-params-editor");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((params as any).focusParam).toBe("pin");
  });
});
