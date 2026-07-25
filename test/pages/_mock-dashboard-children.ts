import { vi } from "vitest";

// Stubs every child component the dashboard page renders (real ones crash
// under happy-dom). Import for side effect before the page import:
//   import "./_mock-dashboard-children.js";
// The vi.mock calls run when this module is evaluated, so they register
// before later imports pull in the components. Paths resolve relative to
// this file, so it must stay beside the page tests.
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("../../src/components/accept-peer-dialog.js", () => ({}));
vi.mock("../../src/components/adopt-dialog.js", () => ({}));
vi.mock("../../src/components/api-key-dialog.js", () => ({}));
vi.mock("../../src/components/archived-devices-dialog.js", () => ({}));
vi.mock("../../src/components/clone-device-dialog.js", () => ({}));
vi.mock("../../src/components/command-dialog.js", () => ({}));
vi.mock("../../src/components/confirm-dialog.js", () => ({}));
vi.mock("../../src/components/dashboard/device-drawer.js", () => ({}));
vi.mock("../../src/components/dashboard/device-table.js", () => ({}));
vi.mock("../../src/components/dashboard/table-row-menu.js", () => ({}));
vi.mock("../../src/components/device-card.js", () => ({}));
vi.mock("../../src/components/device/board-reselect-dialog.js", () => ({}));
vi.mock("../../src/components/discovered-device-card.js", () => ({}));
vi.mock("../../src/components/firmware-install-dialog.js", () => ({}));
vi.mock("../../src/components/friendly-name-dialog.js", () => ({}));
vi.mock("../../src/components/install-method-dialog.js", () => ({}));
vi.mock("../../src/components/labels/bulk-labels-dialog.js", () => ({}));
vi.mock("../../src/components/labels/label-dialog.js", () => ({}));
vi.mock("../../src/components/logs-dialog.js", () => ({}));
vi.mock("../../src/components/rename-device-dialog.js", () => ({}));
vi.mock("../../src/components/select-bar.js", () => ({}));
vi.mock("../../src/components/wizard/create-config-dialog.js", () => ({}));
