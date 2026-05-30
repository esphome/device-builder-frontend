/**
 * @vitest-environment happy-dom
 *
 * When the parsed automation carries an ``error`` (the backend
 * couldn't decompose it), the editor renders read-only and never
 * upserts — its empty tree must not overwrite the real YAML (#1050).
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
import type {
  AutomationLocation,
  AvailableAutomations,
  ParsedAutomation,
} from "../../../../src/api/types.js";
import { ESPHomeAutomationEditor } from "../../../../src/components/device/automation-editor/automation-editor.js";

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
    raw_yaml: "on_boot:\n  then:\n    - made_up: 1\n",
    error: "Unknown action id: 'made_up'",
  } as unknown as ParsedAutomation,
];

const slimAvailable = (): AvailableAutomations =>
  ({
    triggers: [],
    actions: [],
    conditions: [],
    scripts: [],
    devices: [],
  }) as unknown as AvailableAutomations;

async function flushPending(times = 8): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

describe("automation-editor uneditable (errored parse)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders read-only and never upserts when the parsed automation has an error", async () => {
    const upsertAutomation = vi.fn();
    const api = {
      getAvailableAutomations: vi.fn().mockResolvedValue(slimAvailable()),
      getAutomationBodies: vi.fn().mockResolvedValue({}),
      parseDeviceAutomations: vi.fn().mockResolvedValue(erroredParse()),
      upsertAutomation,
    } as unknown as ESPHomeAPI;

    const editor = new ESPHomeAutomationEditor();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (editor as any)._api = api;
    editor.configuration = "device.yaml";
    editor.location = ON_BOOT;
    document.body.appendChild(editor);
    await editor.updateComplete;
    await flushPending();

    // The errored automation is flagged read-only; its empty tree was
    // not adopted, and the error surfaces in the rendered panel.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((editor as any)._parseError.active).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((editor as any).value).toBeNull();
    expect(editor.shadowRoot?.textContent).toContain("made_up");
    expect(upsertAutomation).not.toHaveBeenCalled();
  });

  it("_autoApply is a no-op while uneditable even with a value present", async () => {
    const upsertAutomation = vi.fn();
    const api = {
      getAvailableAutomations: vi.fn().mockResolvedValue(slimAvailable()),
      getAutomationBodies: vi.fn().mockResolvedValue({}),
      upsertAutomation,
    } as unknown as ESPHomeAPI;

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
    await (editor as any)._autoApply();
    expect(upsertAutomation).not.toHaveBeenCalled();
  });
});
