/**
 * Shared scaffolding for the automation-editor suites: the union of
 * the heavy-children no-op ``vi.mock``s every mount suite needs, the
 * slim catalog and seed-tree factories, a parameterizable API mock,
 * and the mount-and-settle helper. Suite-specific fixtures stay in
 * their suites.
 *
 * Import this module with a bare side-effect import BEFORE any
 * editor import — the mock registrations are import-order dependent
 * (same pattern as ``test/pages/_mock-dashboard-children.ts``), and
 * the pinned organize-imports plugin alphabetizes *named* imports
 * below the ``../../../../src`` editor specifiers while leaving
 * side-effect imports in place. The suites' separate named import
 * for the helpers is therefore deliberate, not redundant.
 */
import { afterEach, vi } from "vitest";

vi.mock("../../../../src/components/device/config-entry-form.js", () => ({}));
vi.mock(
  "../../../../src/components/device/automation-editor/automation-action-list.js",
  () => ({})
);
// The shared picker host would mount the real dialog chain (base-dialog,
// wa-dialog, wa-button), which happy-dom cannot upgrade.
vi.mock(
  "../../../../src/components/device/automation-editor/catalog-picker-host.js",
  () => ({
    requestCatalogPick: () => {},
  })
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
  /** Stub with an observable ``open()`` so delete-gate suites can
   *  assert the dialog was asked to show. */
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

import { flushMicrotasks } from "../../../_dom.js";
import type { ESPHomeAPI } from "../../../../src/api/index.js";
import type {
  AutomationLocation,
  AutomationTree,
  AvailableAutomations,
  ParsedAutomation,
} from "../../../../src/api/types/automations.js";
import { _clearAutomationParseCache } from "../../../../src/components/device/automation-editor/base-editor.js";
import type { BaseAutomationEditor } from "../../../../src/components/device/automation-editor/base-editor.js";

// A parse left in flight by one suite must not be shared with the next.
afterEach(() => _clearAutomationParseCache());

/** Minimal editable tree for seeding an editor in edit mode. */
export const seedTree = (): AutomationTree => ({
  trigger_id: null,
  trigger_params: {},
  actions: [],
});

/** One ``automations/parse`` row, a script by default. */
export const parsedAutomation = (
  over: Partial<ParsedAutomation> = {}
): ParsedAutomation => ({
  location: { kind: "script", id: "s" },
  label: "s",
  automation: seedTree(),
  from_line: 1,
  to_line: 3,
  raw_yaml: "",
  ...over,
});

export const slimAvailable = (): AvailableAutomations => ({
  triggers: [],
  actions: [],
  conditions: [],
  scripts: [],
  devices: [],
});

const editorApiDefaults = (available: AvailableAutomations) => ({
  getAvailableAutomations: vi.fn().mockResolvedValue(available),
  getAutomationBodies: vi.fn().mockResolvedValue({}),
  parseDeviceAutomations: vi.fn().mockResolvedValue([]),
  upsertAutomation: vi.fn().mockResolvedValue({
    yaml_diff: { fromLine: 0, toLine: 0, replacement: "" },
  }),
  deleteAutomation: vi.fn().mockResolvedValue({
    yaml_diff: { fromLine: 0, toLine: 0, replacement: "" },
  }),
  updateConfig: vi.fn().mockResolvedValue(undefined),
});

export type EditorApiMock = ReturnType<typeof editorApiDefaults>;

/** API mock covering every verb the editors call at mount or on
 *  write. ``overrides`` is keyed to the real verbs so a typo is a
 *  compile error instead of a vacuous pass; ``available`` is the
 *  catalog the default load resolves. */
export const makeEditorApi = (
  overrides: Partial<EditorApiMock> = {},
  available: AvailableAutomations = slimAvailable()
): EditorApiMock => ({
  ...editorApiDefaults(available),
  ...overrides,
});

/** Slim catalog carrying one hydratable action — shared by the
 *  script / api-action hydration suites (#1286). */
export const slimWithLoggerAction = (): AvailableAutomations =>
  ({
    triggers: [],
    actions: [{ id: "logger.log", config_entries: [] }],
    conditions: [],
    scripts: [],
    devices: [],
  }) as unknown as AvailableAutomations;

export const loggerBodies = () => ({
  "actions/logger.log": {
    id: "logger.log",
    config_entries: [{ key: "format", type: "string", label: "Format", required: true }],
  },
});

/** Plant the api, seed the optional identity, mount, and settle. */
export async function mountEditor<E extends BaseAutomationEditor<AutomationLocation>>(
  editor: E,
  api: EditorApiMock | ESPHomeAPI,
  opts: {
    configuration?: string;
    location?: AutomationLocation;
    value?: AutomationTree;
    /** Microtask flushes after mount; hydration suites need more. */
    settle?: number;
  } = {}
): Promise<E> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (editor as any)._api = api as unknown as ESPHomeAPI;
  if (opts.configuration !== undefined) editor.configuration = opts.configuration;
  if (opts.location !== undefined) editor.location = opts.location;
  if (opts.value !== undefined) editor.value = opts.value;
  document.body.appendChild(editor);
  await editor.updateComplete;
  await flushMicrotasks(opts.settle ?? 5);
  return editor;
}
