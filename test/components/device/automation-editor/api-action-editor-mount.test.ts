/**
 * @vitest-environment happy-dom
 *
 * Mount test for api-action-editor.ts catalog hydration (#1286). Like
 * the script editor, actions inside an api action must arrive with
 * config_entries hydrated or they render fieldless. Heavy children are
 * no-op mocked so the editor constructs in a happy-dom window.
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
vi.mock("@home-assistant/webawesome/dist/components/spinner/spinner.js", () => ({}));
vi.mock("sonner-js", () => ({ default: { error: vi.fn() } }));

import toast from "sonner-js";
import type { ESPHomeAPI } from "../../../../src/api/index.js";
import type { AvailableAutomations } from "../../../../src/api/types/automations.js";
import { ESPHomeApiActionEditor } from "../../../../src/components/device/automation-editor/api-action-editor.js";
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
): Promise<ESPHomeApiActionEditor> {
  const editor = new ESPHomeApiActionEditor();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (editor as any)._api = api;
  if (configuration !== undefined) editor.configuration = configuration;
  Object.assign(editor, props);
  document.body.appendChild(editor);
  await editor.updateComplete;
  await flushMicrotasks(30);
  return editor;
}

describe("api-action-editor action-catalog hydration (#1286)", () => {
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
      location: { kind: "api_action", action_name: "ring_bell" },
      value: {
        trigger_id: null,
        trigger_params: {},
        actions: [{ action_id: "logger.log", params: {}, children: {}, conditions: [] }],
      },
      focusYamlPath: ["api", "actions", 0, "then", 0, "logger.log", "format"],
    });

    const list = editor.shadowRoot!.querySelector("esphome-automation-action-list");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((list as any).focusTarget).toEqual({ node: [0], field: ["format"] });
  });

  it("flashes the name field for an action-key cursor path", async () => {
    const scrolled = vi
      .spyOn(HTMLElement.prototype, "scrollIntoView")
      .mockImplementation(() => {});
    const getAvailableAutomations = vi.fn().mockResolvedValue(slimWithLoggerAction());
    const getAutomationBodies = vi.fn().mockResolvedValue({});
    const api = { getAvailableAutomations, getAutomationBodies } as unknown as ESPHomeAPI;

    const editor = await mountEditor(api, "device.yaml", {
      location: { kind: "api_action", action_name: "ring_bell" },
      value: { trigger_id: null, trigger_params: {}, actions: [] },
      focusYamlPath: ["api", "actions", 0, "action"],
    });

    expect(scrolled).toHaveBeenCalledTimes(1);
    const field = editor.shadowRoot!.querySelector("#api-action-name")!.closest(".field");
    expect(scrolled.mock.instances[0]).toBe(field);
    vi.restoreAllMocks();
  });

  it("routes a variables cursor path to the params editor", async () => {
    const getAvailableAutomations = vi.fn().mockResolvedValue(slimWithLoggerAction());
    const getAutomationBodies = vi.fn().mockResolvedValue({});
    const api = { getAvailableAutomations, getAutomationBodies } as unknown as ESPHomeAPI;

    const editor = await mountEditor(api, "device.yaml", {
      location: { kind: "api_action", action_name: "ring_bell" },
      value: {
        trigger_id: null,
        trigger_params: { variables: { times: "int" } },
        actions: [],
      },
      focusYamlPath: ["api", "actions", 0, "variables", "times"],
    });

    const params = editor.shadowRoot!.querySelector("esphome-callable-params-editor");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((params as any).focusParam).toBe("times");
  });
});
