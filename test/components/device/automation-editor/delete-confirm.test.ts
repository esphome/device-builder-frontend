/**
 * @vitest-environment happy-dom
 *
 * The Delete button in all three editors opens a confirm dialog and
 * only the dialog's confirm event reaches the delete engine. Heavy
 * children are no-op mocked; the confirm dialog is stubbed with an
 * observable ``open()``.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/components/device/config-entry-form.js", () => ({}));
vi.mock(
  "../../../../src/components/device/automation-editor/automation-action-list.js",
  () => ({})
);
vi.mock(
  "../../../../src/components/device/automation-editor/automation-target-picker.js",
  () => ({})
);
vi.mock(
  "../../../../src/components/device/automation-editor/automation-trigger-picker.js",
  () => ({})
);
vi.mock(
  "../../../../src/components/device/automation-editor/callable-params-editor.js",
  () => ({})
);
vi.mock("../../../../src/components/confirm-dialog.js", () => {
  class StubConfirmDialog extends HTMLElement {
    open = vi.fn();
  }
  customElements.define("esphome-confirm-dialog", StubConfirmDialog);
  return {};
});
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/option/option.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/select/select.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/spinner/spinner.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/switch/switch.js", () => ({}));
vi.mock("sonner-js", () => ({ default: { error: vi.fn() } }));

import type { ESPHomeAPI } from "../../../../src/api/index.js";
import type {
  AutomationLocation,
  AvailableAutomations,
} from "../../../../src/api/types/automations.js";
import { ESPHomeApiActionEditor } from "../../../../src/components/device/automation-editor/api-action-editor.js";
import { ESPHomeAutomationEditor } from "../../../../src/components/device/automation-editor/automation-editor.js";
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
  deleteAutomation: vi.fn().mockResolvedValue({
    yaml_diff: { fromLine: 0, toLine: 0, replacement: "" },
  }),
  updateConfig: vi.fn().mockResolvedValue(undefined),
});

async function mountEditor(
  editor: ESPHomeAutomationEditor | ESPHomeScriptEditor | ESPHomeApiActionEditor,
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
  await editor.updateComplete;
}

const CASES: Array<{
  name: string;
  make: () => ESPHomeAutomationEditor | ESPHomeScriptEditor | ESPHomeApiActionEditor;
  location: AutomationLocation;
  expectedName: string;
}> = [
  {
    name: "automation editor",
    make: () => new ESPHomeAutomationEditor(),
    location: { kind: "device_on", trigger: "on_boot" },
    // No trigger catalog loaded in the test, so the header-title
    // fallback is the interpolated name.
    expectedName: "device.automation_header_title_static",
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

describe.each(CASES)("$name delete confirm gate", ({ make, location, expectedName }) => {
  it("clicking Delete opens the confirm dialog without deleting", async () => {
    const api = makeApi();
    const editor = make();
    await mountEditor(editor, api, location);

    const button = editor.shadowRoot!.querySelector<HTMLButtonElement>(".ae-danger")!;
    expect(button).not.toBeNull();
    button.click();
    await flushMicrotasks(3);

    const dialog = editor.shadowRoot!.querySelector("esphome-confirm-dialog") as any;
    expect(dialog.open).toHaveBeenCalledOnce();
    expect(api.deleteAutomation).not.toHaveBeenCalled();
  });

  it("the dialog's confirm event runs the delete", async () => {
    const api = makeApi();
    const editor = make();
    await mountEditor(editor, api, location);

    const dialog = editor.shadowRoot!.querySelector("esphome-confirm-dialog")!;
    dialog.dispatchEvent(new CustomEvent("confirm", { bubbles: true }));
    await flushMicrotasks(5);

    expect(api.deleteAutomation).toHaveBeenCalledOnce();
    expect(api.deleteAutomation).toHaveBeenCalledWith("device.yaml", location, "");
  });

  it("names the delete target in the confirm message", async () => {
    const api = makeApi();
    const editor = make();
    (editor as any)._localize = (key: string, params?: Record<string, string>) =>
      params?.name ? `${key}:${params.name}` : key;
    await mountEditor(editor, api, location);

    const dialog = editor.shadowRoot!.querySelector("esphome-confirm-dialog")!;
    expect(dialog.getAttribute("message")!.endsWith(`:${expectedName}`)).toBe(true);
  });
});
