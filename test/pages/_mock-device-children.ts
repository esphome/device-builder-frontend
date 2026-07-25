import { vi } from "vitest";

// Stubs the heavy children the device page renders (yaml-editor drags
// in CodeMirror, the dialogs crash under happy-dom) plus sonner's
// toaster. Import for side effect before the page import:
//   import "./_mock-device-children.js";
// The vi.mock calls run when this module is evaluated, so they
// register before later imports pull in the components; the pinned
// organize-imports plugin never moves side-effect imports, so the
// ordering is stable. Paths resolve relative to this file, so it must
// stay beside the page tests. Suite-specific mocks (e.g.
// board-reselect-dialog) stay in their suites.
vi.mock("sonner-js", () => ({
  default: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("../../src/components/command-dialog.js", () => ({}));
vi.mock("../../src/components/device/device-editor.js", () => ({}));
vi.mock("../../src/components/device/device-navigator.js", () => ({}));
vi.mock("../../src/components/firmware-install-dialog.js", () => ({}));
vi.mock("../../src/components/install-method-dialog.js", () => ({}));
vi.mock("../../src/components/logs-dialog.js", () => ({}));
vi.mock("../../src/components/unsaved-changes-dialog.js", () => ({}));
vi.mock("../../src/components/yaml-validation-dialog.js", () => ({}));
vi.mock("../../src/components/device/device-install-controller.js", () => ({
  DeviceInstallController: class {
    constructor() {}
  },
}));
