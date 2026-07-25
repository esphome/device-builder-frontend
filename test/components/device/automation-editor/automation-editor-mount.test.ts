/**
 * @vitest-environment happy-dom
 *
 * Behavioral mount tests for ``automation-editor.ts``. The editor's
 * deps drag CodeMirror in through ``config-entry-form`` →
 * ``lambda-editor``, plus the action-list / target-picker /
 * trigger-picker children. The shared harness no-ops them so the
 * editor itself can construct in a happy-dom window.
 */
import { describe, expect, it, vi } from "vitest";

import "./_editor-harness.js";

import type { AvailableAutomations } from "../../../../src/api/types/automations.js";
import { ESPHomeAutomationEditor } from "../../../../src/components/device/automation-editor/automation-editor.js";
import { flushMicrotasks } from "../../../_dom.js";
import { makeEditorApi, mountEditor } from "./_editor-harness.js";

describe("automation-editor mount-time load (behavioral)", () => {
  it("editor mounted with configuration preset issues exactly one getAvailableAutomations call", async () => {
    const api = makeEditorApi();

    await mountEditor(new ESPHomeAutomationEditor(), api, {
      configuration: "device.yaml",
    });

    expect(api.getAvailableAutomations).toHaveBeenCalledTimes(1);
    // Second arg is the editor's draft yaml (empty here), forwarded so a
    // wizard-added component's triggers scope off the draft (#1348).
    expect(api.getAvailableAutomations).toHaveBeenCalledWith("device.yaml", "");
  });

  it("editor mounted without configuration does not call getAvailableAutomations", async () => {
    const api = makeEditorApi();

    await mountEditor(new ESPHomeAutomationEditor(), api);

    expect(api.getAvailableAutomations).not.toHaveBeenCalled();
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
    const api = makeEditorApi({
      getAvailableAutomations: vi.fn().mockResolvedValue(slim),
      getAutomationBodies: vi.fn(
        () =>
          new Promise<Record<string, unknown>>((r) => {
            resolveBodies = r;
          })
      ),
    });

    const editor = await mountEditor(new ESPHomeAutomationEditor(), api, {
      configuration: "device.yaml",
    });

    expect(api.getAvailableAutomations).toHaveBeenCalledTimes(1);
    expect(api.getAutomationBodies).toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((editor as any)._loading).toBe(false);

    resolveBodies({});
    await flushMicrotasks(5);
  });

  it("setting configuration after mount triggers the load", async () => {
    const api = makeEditorApi();

    const editor = await mountEditor(new ESPHomeAutomationEditor(), api);
    expect(api.getAvailableAutomations).not.toHaveBeenCalled();

    editor.configuration = "device.yaml";
    await editor.updateComplete;
    await flushMicrotasks(5);

    expect(api.getAvailableAutomations).toHaveBeenCalledTimes(1);
  });

  it("renders a component_action location titled by the field label", async () => {
    const api = makeEditorApi();
    const editor = new ESPHomeAutomationEditor();
    // Interpolating localize stub (no context provider in the test tree)
    // so the ``{name} action`` header template resolves.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (editor as any)._localize = (key: string, values?: Record<string, string>) =>
      key === "device.action_field_label" ? `${values?.name} action` : key;

    await mountEditor(editor, api, {
      configuration: "device.yaml",
      location: {
        kind: "component_action",
        component_id: "my_gate",
        field: "open_action",
      },
      value: { trigger_id: null, trigger_params: {}, actions: [] } as never,
    });

    // Header derives from the field (no trigger to name); edit-mode means
    // the add-only trigger picker is never instantiated.
    expect(editor.shadowRoot?.textContent ?? "").toContain("Open action");
  });
});
