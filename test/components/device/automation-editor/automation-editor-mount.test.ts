/**
 * @vitest-environment happy-dom
 *
 * Behavioral mount tests for ``automation-editor.ts``. The bulk of
 * the editor's deps drag CodeMirror in through ``config-entry-form``
 * → ``lambda-editor``, plus the action-list / target-picker /
 * trigger-picker children, none of which we need to exercise the
 * mount-time load path. ``vi.mock`` no-ops them so the editor itself
 * can construct in a happy-dom window.
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

describe("automation-editor mount-time load (behavioral)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("editor mounted with configuration preset issues exactly one getAvailableAutomations call", async () => {
    const getAvailableAutomations = vi.fn().mockResolvedValue(slimAvailable());
    const getAutomationBodies = vi.fn().mockResolvedValue({});
    const api = {
      getAvailableAutomations,
      getAutomationBodies,
    } as unknown as ESPHomeAPI;

    const editor = new ESPHomeAutomationEditor();
    // ``_api`` lives behind a Lit context consumer; in tests we
    // assign it directly because there's no provider in the tree.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (editor as any)._api = api;
    editor.configuration = "device.yaml";
    document.body.appendChild(editor);
    await editor.updateComplete;
    await flushPending();

    expect(getAvailableAutomations).toHaveBeenCalledTimes(1);
    expect(getAvailableAutomations).toHaveBeenCalledWith("device.yaml");
  });

  it("editor mounted without configuration does not call getAvailableAutomations", async () => {
    const getAvailableAutomations = vi.fn().mockResolvedValue(slimAvailable());
    const api = { getAvailableAutomations } as unknown as ESPHomeAPI;

    const editor = new ESPHomeAutomationEditor();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (editor as any)._api = api;
    document.body.appendChild(editor);
    await editor.updateComplete;
    await flushPending();

    expect(getAvailableAutomations).not.toHaveBeenCalled();
  });

  it("setting configuration after mount triggers the load", async () => {
    const getAvailableAutomations = vi.fn().mockResolvedValue(slimAvailable());
    const getAutomationBodies = vi.fn().mockResolvedValue({});
    const api = {
      getAvailableAutomations,
      getAutomationBodies,
    } as unknown as ESPHomeAPI;

    const editor = new ESPHomeAutomationEditor();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (editor as any)._api = api;
    document.body.appendChild(editor);
    await editor.updateComplete;
    expect(getAvailableAutomations).not.toHaveBeenCalled();

    editor.configuration = "device.yaml";
    await editor.updateComplete;
    await flushPending();

    expect(getAvailableAutomations).toHaveBeenCalledTimes(1);
  });
});
