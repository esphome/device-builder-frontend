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

async function flushPending(times = 30): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

async function mountEditor(
  api: ESPHomeAPI,
  configuration?: string
): Promise<ESPHomeApiActionEditor> {
  const editor = new ESPHomeApiActionEditor();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (editor as any)._api = api;
  if (configuration !== undefined) editor.configuration = configuration;
  document.body.appendChild(editor);
  await editor.updateComplete;
  await flushPending();
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
});
