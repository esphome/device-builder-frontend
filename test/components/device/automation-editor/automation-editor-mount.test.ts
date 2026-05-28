/**
 * @vitest-environment happy-dom
 *
 * Behavioral mount tests for ``automation-editor.ts``. The editor's
 * deps drag CodeMirror in through ``config-entry-form`` →
 * ``lambda-editor``, plus the action-list / target-picker /
 * trigger-picker children. ``vi.mock`` no-ops them so the editor
 * itself can construct in a happy-dom window.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

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
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/spinner/spinner.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/switch/switch.js", () => ({}));
vi.mock("sonner-js", () => ({ default: { error: vi.fn() } }));

import type { ESPHomeAPI } from "../../../../src/api/index.js";
import type { AvailableAutomations } from "../../../../src/api/types.js";
import { ESPHomeAutomationEditor } from "../../../../src/components/device/automation-editor/automation-editor.js";

const slimAvailable = (): AvailableAutomations =>
  ({
    triggers: [],
    actions: [],
    conditions: [],
    scripts: [],
    devices: [],
  }) as unknown as AvailableAutomations;

async function flushPending(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

/** Construct an editor, plant the api on its consumer-private
 *  ``_api`` slot (no Lit context provider in the test tree),
 *  optionally set ``configuration``, then mount and settle the
 *  lifecycle. */
async function mountEditor(
  api: ESPHomeAPI,
  configuration?: string
): Promise<ESPHomeAutomationEditor> {
  const editor = new ESPHomeAutomationEditor();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (editor as any)._api = api;
  if (configuration !== undefined) editor.configuration = configuration;
  document.body.appendChild(editor);
  await editor.updateComplete;
  await flushPending();
  return editor;
}

describe("automation-editor mount-time load (behavioral)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("editor mounted with configuration preset issues exactly one getAvailableAutomations call", async () => {
    const getAvailableAutomations = vi.fn().mockResolvedValue(slimAvailable());
    const getAutomationBodies = vi.fn().mockResolvedValue({});
    const api = { getAvailableAutomations, getAutomationBodies } as unknown as ESPHomeAPI;

    await mountEditor(api, "device.yaml");

    expect(getAvailableAutomations).toHaveBeenCalledTimes(1);
    expect(getAvailableAutomations).toHaveBeenCalledWith("device.yaml");
  });

  it("editor mounted without configuration does not call getAvailableAutomations", async () => {
    const getAvailableAutomations = vi.fn().mockResolvedValue(slimAvailable());
    const api = { getAvailableAutomations } as unknown as ESPHomeAPI;

    await mountEditor(api);

    expect(getAvailableAutomations).not.toHaveBeenCalled();
  });

  it("drops the loading spinner once the slim list lands (paint before hydration)", async () => {
    // Uses a non-empty trigger list so hydration actually awaits
    // ``getAutomationBodies``; an empty list resolves the inner
    // ``Promise.allSettled`` synchronously and there's no
    // "during hydration" state to observe.
    const slim = {
      triggers: [{ id: "on_boot", config_entries: [] }],
      actions: [],
      conditions: [],
      scripts: [],
      devices: [],
    } as unknown as AvailableAutomations;
    let resolveBodies!: (v: Record<string, unknown>) => void;
    const getAvailableAutomations = vi.fn().mockResolvedValue(slim);
    const getAutomationBodies = vi.fn(
      () =>
        new Promise<Record<string, unknown>>((r) => {
          resolveBodies = r;
        })
    );
    const api = { getAvailableAutomations, getAutomationBodies } as unknown as ESPHomeAPI;

    const editor = await mountEditor(api, "device.yaml");

    expect(getAvailableAutomations).toHaveBeenCalledTimes(1);
    expect(getAutomationBodies).toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((editor as any)._loading).toBe(false);

    resolveBodies({});
    await flushPending();
  });

  it("setting configuration after mount triggers the load", async () => {
    const getAvailableAutomations = vi.fn().mockResolvedValue(slimAvailable());
    const getAutomationBodies = vi.fn().mockResolvedValue({});
    const api = { getAvailableAutomations, getAutomationBodies } as unknown as ESPHomeAPI;

    const editor = await mountEditor(api);
    expect(getAvailableAutomations).not.toHaveBeenCalled();

    editor.configuration = "device.yaml";
    await editor.updateComplete;
    await flushPending();

    expect(getAvailableAutomations).toHaveBeenCalledTimes(1);
  });
});
