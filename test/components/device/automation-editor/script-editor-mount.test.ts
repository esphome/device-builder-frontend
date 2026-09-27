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

import "./_editor-harness.js";

import toast from "sonner-js";
import type { ESPHomeAPI } from "../../../../src/api/index.js";
import type { AvailableAutomations } from "../../../../src/api/types/automations.js";
import { ESPHomeScriptEditor } from "../../../../src/components/device/automation-editor/script-editor.js";
import { _clearAutomationBodyCache } from "../../../../src/util/automation-body-cache.js";

import {
  loggerBodies,
  mountEditor as mountHarness,
  slimWithLoggerAction,
} from "./_editor-harness.js";

async function mountEditor(
  api: ESPHomeAPI,
  configuration?: string,
  props: object = {}
): Promise<ESPHomeScriptEditor> {
  const editor = Object.assign(new ESPHomeScriptEditor(), props);
  return mountHarness(
    editor,
    api,
    configuration !== undefined ? { configuration, settle: 30 } : { settle: 30 }
  );
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

  describe("script id (#1883)", () => {
    const SCRIPT = {
      location: { kind: "script", id: "my_script" },
      value: {
        trigger_id: null,
        trigger_params: { id: "my_script" },
        actions: [{ action_id: "logger.log", params: {}, children: {}, conditions: [] }],
      },
      _scriptComponent: {
        config_entries: [
          { key: "id", type: "string", label: "ID" },
          { key: "mode", type: "enum", label: "Mode" },
        ],
      },
    };

    function slimApi(): ESPHomeAPI {
      return {
        getAvailableAutomations: vi.fn().mockResolvedValue(slimWithLoggerAction()),
        getAutomationBodies: vi.fn().mockResolvedValue({}),
      } as unknown as ESPHomeAPI;
    }

    it("shows the id in a read only field, outside the form", async () => {
      const editor = await mountEditor(slimApi(), "device.yaml", SCRIPT);

      const input = editor.shadowRoot!.querySelector<HTMLInputElement>("#script-id")!;
      expect(input.value).toBe("my_script");
      expect(input.readOnly).toBe(true);
      const form = editor.shadowRoot!.querySelector("esphome-config-entry-form");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((form as any).entries.map((e: { key: string }) => e.key)).toEqual(["mode"]);
    });

    it("keeps the script and its actions when another field is edited", async () => {
      const editor = await mountEditor(slimApi(), "device.yaml", SCRIPT);
      const form = editor.shadowRoot!.querySelector("esphome-config-entry-form")!;

      form.dispatchEvent(
        new CustomEvent("value-change", { detail: { path: ["mode"], value: "queued" } })
      );
      await editor.updateComplete;

      expect(editor.location).toEqual({ kind: "script", id: "my_script" });
      expect(editor.value!.trigger_params).toEqual({ id: "my_script", mode: "queued" });
      expect(editor.value!.actions).toHaveLength(1);
    });

    it("flashes the id field when the cursor is on the id line", async () => {
      const scrolled = vi
        .spyOn(HTMLElement.prototype, "scrollIntoView")
        .mockImplementation(() => {});

      const editor = await mountEditor(slimApi(), "device.yaml", {
        ...SCRIPT,
        focusYamlPath: ["script", 0, "id"],
      });

      expect(scrolled).toHaveBeenCalledTimes(1);
      const field = editor.shadowRoot!.querySelector("#script-id")!.closest(".field");
      expect(scrolled.mock.instances[0]).toBe(field);
      vi.restoreAllMocks();
    });
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
