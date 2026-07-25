/**
 * @vitest-environment happy-dom
 *
 * The Delete button in all three editors opens a confirm dialog and
 * only the dialog's confirm event reaches the delete engine. Heavy
 * children are no-op mocked; the confirm dialog is stubbed with an
 * observable ``open()``.
 */
import { describe, expect, it, vi } from "vitest";

import "./_editor-harness.js";

import type {
  AutomationLocation,
  AvailableAutomations,
} from "../../../../src/api/types/automations.js";
import { ESPHomeApiActionEditor } from "../../../../src/components/device/automation-editor/api-action-editor.js";
import { ESPHomeAutomationEditor } from "../../../../src/components/device/automation-editor/automation-editor.js";
import { ESPHomeScriptEditor } from "../../../../src/components/device/automation-editor/script-editor.js";
import { flushMicrotasks } from "../../../_dom.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

import { makeEditorApi, mountEditor, slimAvailable } from "./_editor-harness.js";

async function mountAndSettle(
  editor: ESPHomeAutomationEditor | ESPHomeScriptEditor | ESPHomeApiActionEditor,
  api: ReturnType<typeof makeEditorApi>,
  location: AutomationLocation
) {
  await mountEditor(editor, api, {
    configuration: "device.yaml",
    location,
    value: { trigger_id: null, trigger_params: {}, actions: [] } as never,
  });
  await editor.updateComplete;
}

const CASES: Array<{
  name: string;
  make: () => ESPHomeAutomationEditor | ESPHomeScriptEditor | ESPHomeApiActionEditor;
  location: AutomationLocation;
  available?: AvailableAutomations;
  expectedName: string;
}> = [
  {
    name: "automation editor",
    make: () => new ESPHomeAutomationEditor(),
    location: { kind: "device_on", trigger: "on_boot" },
    available: {
      ...slimAvailable(),
      triggers: [{ id: "on_boot", name: "On Boot", config_entries: [] }],
    } as unknown as AvailableAutomations,
    expectedName: "On Boot",
  },
  {
    name: "script editor",
    make: () => new ESPHomeScriptEditor(),
    location: { kind: "script", id: "my_script" },
    expectedName: "my_script",
  },
  {
    name: "api-action editor",
    make: () => new ESPHomeApiActionEditor(),
    location: { kind: "api_action", action_name: "my_action" },
    expectedName: "my_action",
  },
];

describe.each(CASES)(
  "$name delete confirm gate",
  ({ make, location, available, expectedName }) => {
    it("clicking Delete opens the confirm dialog without deleting", async () => {
      const api = makeEditorApi(
        available ? { getAvailableAutomations: vi.fn().mockResolvedValue(available) } : {}
      );
      const editor = make();
      await mountAndSettle(editor, api, location);

      const button = editor.shadowRoot!.querySelector<HTMLButtonElement>(".ae-danger")!;
      expect(button).not.toBeNull();
      button.click();
      await flushMicrotasks(3);

      const dialog = editor.shadowRoot!.querySelector("esphome-confirm-dialog") as any;
      expect(dialog.open).toHaveBeenCalledOnce();
      expect(api.deleteAutomation).not.toHaveBeenCalled();
    });

    it("the dialog's confirm event runs the delete", async () => {
      const api = makeEditorApi();
      const editor = make();
      await mountAndSettle(editor, api, location);

      const dialog = editor.shadowRoot!.querySelector("esphome-confirm-dialog")!;
      dialog.dispatchEvent(new CustomEvent("confirm", { bubbles: true }));
      await flushMicrotasks(5);

      expect(api.deleteAutomation).toHaveBeenCalledOnce();
      expect(api.deleteAutomation).toHaveBeenCalledWith("device.yaml", location, "");
    });

    it("names the delete target in the confirm message", async () => {
      const api = makeEditorApi(
        available ? { getAvailableAutomations: vi.fn().mockResolvedValue(available) } : {}
      );
      const editor = make();
      (editor as any)._localize = (key: string, params?: Record<string, string>) =>
        params?.name ? `${key}:${params.name}` : key;
      await mountAndSettle(editor, api, location);

      const dialog = editor.shadowRoot!.querySelector("esphome-confirm-dialog")!;
      expect(dialog.getAttribute("message")!.endsWith(`:${expectedName}`)).toBe(true);
    });
  }
);

describe("automation editor delete confirm before the catalog resolves", () => {
  it("falls back to the raw trigger key, not the generic title", async () => {
    const api = makeEditorApi();
    const editor = new ESPHomeAutomationEditor();
    (editor as any)._localize = (key: string, params?: Record<string, string>) =>
      params?.name ? `${key}:${params.name}` : key;
    await mountAndSettle(editor, api, { kind: "device_on", trigger: "on_boot" });

    const dialog = editor.shadowRoot!.querySelector("esphome-confirm-dialog")!;
    expect(dialog.getAttribute("message")!.endsWith(":on_boot")).toBe(true);
  });
});
