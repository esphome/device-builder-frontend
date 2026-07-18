import { vi } from "vitest";

// Stubs the Web Awesome components every dialog test must mock (real ones
// crash under happy-dom). Import this before any component import:
//   import "../_mock-webawesome.js";
// The vi.mock calls run when this module is evaluated, so they register
// before later imports pull in the components.
vi.mock("@home-assistant/webawesome/dist/components/dialog/dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/spinner/spinner.js", () => ({}));
