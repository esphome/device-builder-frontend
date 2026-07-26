/**
 * @vitest-environment happy-dom
 *
 * When the parsed automation carries an ``error`` (the backend
 * couldn't decompose it), the editor renders read-only and never
 * upserts — its empty tree must not overwrite the real YAML (#1050).
 */
import { describe, expect, it, vi } from "vitest";

import "./_editor-harness.js";
import { mountEditor, slimAvailable } from "./_editor-harness.js";

import type { ESPHomeAPI } from "../../../../src/api/index.js";
import type {
  AutomationLocation,
  ParsedAutomation,
} from "../../../../src/api/types/automations.js";
import { ESPHomeAutomationEditor } from "../../../../src/components/device/automation-editor/automation-editor.js";
import { flushMicrotasks } from "../../../_dom.js";

const ON_BOOT: AutomationLocation = {
  kind: "device_on",
  trigger: "on_boot",
} as unknown as AutomationLocation;

const erroredParse = (): ParsedAutomation[] => [
  {
    location: ON_BOOT,
    label: "On Boot",
    automation: { trigger_id: "on_boot", trigger_params: {}, actions: [] },
    from_line: 1,
    to_line: 3,
    // An unknown condition still fails the whole automation (an uncatalogued
    // action instead becomes a passthrough node, so it's no longer a trigger).
    raw_yaml:
      "on_boot:\n  then:\n    - if:\n        condition:\n          - made_up:\n        then: []\n",
    error: "Unknown condition id: 'made_up'",
  } as unknown as ParsedAutomation,
];

const validParse = (): ParsedAutomation[] => [
  {
    location: ON_BOOT,
    label: "On Boot",
    automation: { trigger_id: "on_boot", trigger_params: {}, actions: [] },
    from_line: 1,
    to_line: 2,
    raw_yaml: "on_boot:\n  then: []\n",
  } as unknown as ParsedAutomation,
];

describe("automation-editor uneditable (errored parse)", () => {
  it("renders read-only and never upserts when the parsed automation has an error", async () => {
    const upsertAutomation = vi.fn();
    const api = {
      getAvailableAutomations: vi.fn().mockResolvedValue(slimAvailable()),
      getAutomationBodies: vi.fn().mockResolvedValue({}),
      parseDeviceAutomations: vi.fn().mockResolvedValue(erroredParse()),
      upsertAutomation,
    } as unknown as ESPHomeAPI;

    const editor = await mountEditor(new ESPHomeAutomationEditor(), api, {
      configuration: "device.yaml",
      location: ON_BOOT,
      settle: 8,
    });

    // The errored automation is flagged read-only; its empty tree was
    // not adopted, and the error surfaces in the rendered panel.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((editor as any)._parseError.active).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((editor as any).value).toBeNull();
    expect(editor.shadowRoot?.textContent).toContain("made_up");
    expect(upsertAutomation).not.toHaveBeenCalled();
  });

  it("the engine's autoApply is a no-op while uneditable even with a value present", async () => {
    const upsertAutomation = vi.fn();
    const api = {
      getAvailableAutomations: vi.fn().mockResolvedValue(slimAvailable()),
      getAutomationBodies: vi.fn().mockResolvedValue({}),
      upsertAutomation,
    } as unknown as ESPHomeAPI;

    // Inline mount: unlike the harness helper this seeds a non-null
    // value and stops at updateComplete with no microtask flush.
    const editor = new ESPHomeAutomationEditor();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (editor as any)._api = api;
    editor.configuration = "device.yaml";
    editor.location = ON_BOOT;
    // A value is present (the auto-hydrate is skipped while value is
    // non-null), modelling an editable automation that then turns
    // read-only.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (editor as any).value = { trigger_id: "on_boot", trigger_params: {}, actions: [] };
    document.body.appendChild(editor);
    await editor.updateComplete;

    // Turn read-only through the controller's public resolve (an
    // errored parse), not its private state.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (editor as any)._parseError.resolve(erroredParse(), ON_BOOT);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (editor as any)._engine.autoApply();
    expect(upsertAutomation).not.toHaveBeenCalled();
  });
});

describe("automation-editor parse-error banner", () => {
  it("clears a stale parse error once the YAML parses again", async () => {
    const parseDeviceAutomations = vi
      .fn()
      .mockRejectedValueOnce(new Error("invalid_args: Failed to parse device YAML"))
      .mockResolvedValue(validParse());
    const api = {
      getAvailableAutomations: vi.fn().mockResolvedValue(slimAvailable()),
      getAutomationBodies: vi.fn().mockResolvedValue({}),
      parseDeviceAutomations,
      upsertAutomation: vi.fn(),
    } as unknown as ESPHomeAPI;

    const editor = new ESPHomeAutomationEditor();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (editor as any)._api = api;
    editor.configuration = "device.yaml";
    editor.location = ON_BOOT;
    editor.yaml = "broken: [";
    document.body.appendChild(editor);
    await editor.updateComplete;
    await flushMicrotasks(8);
    // The failed parse surfaced an error banner.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((editor as any)._error).toContain("Failed to parse");

    // The user fixes the YAML in the pane; the parent re-hydrates.
    editor.yaml = "on_boot:\n  then: []\n";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (editor as any).reload();
    await flushMicrotasks(8);
    // A successful parse clears the stale error.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((editor as any)._error).toBe("");
  });
});
