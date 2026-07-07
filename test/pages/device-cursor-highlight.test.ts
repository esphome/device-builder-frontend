/**
 * @vitest-environment happy-dom
 *
 * Pins that clicking in the YAML pane moves the block highlight to the section
 * the caret entered, so the highlight tracks the navigator selection instead of
 * stranding it on the previously clicked component (esphome/device-builder#1885).
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

// i2c: lines 1-3, sensor: lines 4-7. Two distinct top-level sections so a caret
// move crosses a section boundary.
const YAML = [
  "i2c:",
  "  sda: 1",
  "  scl: 0",
  "sensor:",
  "  - platform: aht10",
  "    temperature:",
  "      name: Temperature",
  "",
].join("\n");

function makePage(api: Partial<ESPHomeAPI> = {}): ESPHomePageDevice {
  const page = new ESPHomePageDevice();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (page as any)._api = api as ESPHomeAPI;
  page.id = "kitchen.yaml";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (page as any)._yaml = YAML;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (page as any)._savedYaml = YAML;
  return page;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const internals = (page: ESPHomePageDevice) => page as any;

function clickYamlLine(page: ESPHomePageDevice, line: number, path: string[] = []) {
  internals(page)._onYamlCursorLine(
    new CustomEvent("yaml-cursor-line", { detail: { line, path } })
  );
}

describe("cursor-driven YAML highlight (#1885)", () => {
  // happy-dom shares one window across tests; a prior test's `_updateUrl`
  // leaves `?section=...` behind, which the next page reads on init and
  // pre-selects, turning its first click into a same-section no-op.
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("highlights the section the caret lands in", () => {
    const page = makePage();
    clickYamlLine(page, 2); // inside i2c:
    expect(internals(page)._selectedSection).toBe("i2c");
    expect(internals(page)._highlightRange).toEqual({ fromLine: 1, toLine: 3 });
  });

  it("moves the highlight when the caret crosses into another section", () => {
    const page = makePage();
    clickYamlLine(page, 2); // i2c:
    expect(internals(page)._highlightRange).toEqual({ fromLine: 1, toLine: 3 });

    clickYamlLine(page, 5); // sensor: -> aht10 list item, lines 5-7
    expect(internals(page)._selectedSection).not.toBe("i2c");
    // The regression: this range used to stay on i2c (fromLine 1).
    expect(internals(page)._highlightRange).toEqual({ fromLine: 5, toLine: 7 });
  });

  it("does not re-highlight on an intra-section caret move", () => {
    const page = makePage();
    clickYamlLine(page, 5); // aht10 list item
    const first = internals(page)._highlightRange;
    expect(first).toEqual({ fromLine: 5, toLine: 7 });

    clickYamlLine(page, 6); // still inside the same list item
    // Same object identity: the same-section early return never touched it.
    expect(internals(page)._highlightRange).toBe(first);
  });

  it("leaves highlight and selection on the old section when the guard runs no callback", () => {
    const page = makePage();
    clickYamlLine(page, 2); // i2c:
    const before = internals(page)._highlightRange;

    // The guard always runs its callback today; pin the invariant that if it
    // ever vetoes (invokes no callback), highlight and selection stay put.
    vi.spyOn(internals(page), "_guardSectionSwitch").mockImplementation(() => {});
    clickYamlLine(page, 5); // would move to sensor, but vetoed

    expect(internals(page)._selectedSection).toBe("i2c");
    expect(internals(page)._highlightRange).toBe(before);
  });
});
