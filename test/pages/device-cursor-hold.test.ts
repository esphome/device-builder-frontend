/**
 * @vitest-environment happy-dom
 *
 * Pins the mid-typing hold (esphome/device-builder#2211): an edit-driven
 * cursor event that resolves an unknown top-level key must not switch the
 * structured pane onto the half-typed section, and the held instance's
 * navigator error chip is withheld. Clicks, known keys, and deliberate
 * navigation always switch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import type { ESPHomeAPI } from "../../src/api/index.js";
import { ESPHomePageDevice } from "../../src/pages/device.js";
import type { BackendFieldError } from "../../src/util/backend-field-errors.js";

// i2c: lines 1-3, the half-typed unknown key on line 4 with its just-pressed
// Enter blank on line 5, sensor: from line 6.
const YAML = [
  "i2c:",
  "  sda: 1",
  "  scl: 0",
  "sendx:",
  "",
  "sensor:",
  "  - platform: aht10",
  "    temperature:",
  "      name: Temperature",
  "",
].join("\n");

const KNOWN = new Set(["i2c", "sensor", "logger"]);

function makePage(): ESPHomePageDevice {
  const page = new ESPHomePageDevice();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (page as any)._api = {} as ESPHomeAPI;
  page.id = "kitchen.yaml";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (page as any)._yaml = YAML;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (page as any)._savedYaml = YAML;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (page as any)._knownTopLevelKeys = KNOWN;
  return page;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const internals = (page: ESPHomePageDevice) => page as any;

function cursorEvent(
  page: ESPHomePageDevice,
  line: number,
  opts: { path?: string[]; viaEdit?: boolean } = {}
) {
  internals(page)._onYamlCursorLine(
    new CustomEvent("yaml-cursor-line", {
      detail: { line, path: opts.path ?? [], viaEdit: opts.viaEdit ?? false },
    })
  );
}

describe("mid-typing hold for an unknown top-level key (#2211)", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("holds an edit-driven move onto an unknown key's header line", () => {
    const page = makePage();
    cursorEvent(page, 2); // click into i2c → selected
    expect(internals(page)._selectedSection).toBe("i2c");

    cursorEvent(page, 4, { viaEdit: true }); // typing `sendx:`
    expect(internals(page)._selectedSection).toBe("i2c");
    expect(internals(page)._heldUnknownInstance).toBe("sendx@4");
  });

  it("still holds from a blank child line of the unknown block (Enter leak)", () => {
    const page = makePage();
    cursorEvent(page, 2);
    // Enter + indent under sendx: the indent fallback attributes the blank
    // child line to the block via the path; the caret is no longer on the
    // header line but the hold must persist.
    cursorEvent(page, 5, { path: ["sendx"], viaEdit: true });
    expect(internals(page)._selectedSection).toBe("i2c");
    expect(internals(page)._heldUnknownInstance).not.toBeNull();
  });

  it("switches on an edit-driven move onto a known key (#956 contract)", () => {
    const page = makePage();
    cursorEvent(page, 2);
    cursorEvent(page, 7, { viaEdit: true }); // typing inside sensor:
    expect(internals(page)._selectedSection).toBe("sensor.aht10");
    expect(internals(page)._heldUnknownInstance).toBeNull();
  });

  it("switches on a click onto the unknown section (deliberate visit)", () => {
    const page = makePage();
    cursorEvent(page, 2);
    cursorEvent(page, 4, { viaEdit: false });
    expect(internals(page)._selectedSection).toBe("sendx");
    expect(internals(page)._heldUnknownInstance).toBeNull();
  });

  it("switches on edits while the knownness set has not resolved", () => {
    const page = makePage();
    internals(page)._knownTopLevelKeys = null;
    cursorEvent(page, 2);
    cursorEvent(page, 4, { viaEdit: true });
    // Pre-catalog (or failed catalog) behavior is identical to today.
    expect(internals(page)._selectedSection).toBe("sendx");
  });

  it("keeps the URL untouched while held", () => {
    const page = makePage();
    cursorEvent(page, 2);
    const before = window.location.search;
    cursorEvent(page, 4, { viaEdit: true });
    expect(window.location.search).toBe(before);
  });

  it("releases through a navigator selection", () => {
    const page = makePage();
    cursorEvent(page, 4, { viaEdit: true });
    expect(internals(page)._heldUnknownInstance).not.toBeNull();
    internals(page)._onSectionSelect(
      new CustomEvent("section-select", {
        detail: { sectionKey: "sendx", fromLine: 4 },
      })
    );
    expect(internals(page)._heldUnknownInstance).toBeNull();
    expect(internals(page)._selectedSection).toBe("sendx");
  });

  it("withholds only the held instance's navigator error chip", () => {
    const page = makePage();
    const errors: BackendFieldError[] = [
      { sectionKey: "sendx", fromLine: 4, keyPath: [], message: "x" },
      { sectionKey: "i2c", fromLine: 1, keyPath: [], message: "y" },
    ] as never;
    const counts = internals(page)._navErrorCounts(errors, "sendx@4");
    expect(counts.has("sendx@4")).toBe(false);
    expect(counts.get("i2c@1")).toBe(1);
    const unheld = internals(page)._navErrorCounts(errors, null);
    expect(unheld.get("sendx@4")).toBe(1);
  });
});
