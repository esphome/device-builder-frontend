/**
 * @vitest-environment happy-dom
 *
 * Pins that a deep-link arrival (?line=N, optionally ?section=) derives the
 * structured-editor focus from the loaded YAML once per navigation
 * (esphome/device-builder-frontend#1212) — previously the load path only
 * selected the section and the form always painted from the top.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

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

import { ESPHomePageDevice } from "../../src/pages/device.js";

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const internals = (page: ESPHomePageDevice) => page as any;

function makePage(
  opts: { line?: number; section?: string | null } = {}
): ESPHomePageDevice {
  const page = new ESPHomePageDevice();
  page.id = "kitchen.yaml";
  internals(page)._yaml = YAML;
  internals(page)._savedYaml = YAML;
  internals(page)._pendingUrlLine = opts.line;
  internals(page)._selectedSection = opts.section ?? null;
  return page;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("URL ?line= deep focus on load (#1212)", () => {
  it("a line-only arrival selects the section and derives both focus paths", () => {
    const page = makePage({ line: 2 });
    internals(page)._maybeResolveLineFromUrl();
    expect(internals(page)._selectedSection).toBe("i2c");
    expect(internals(page)._focusFieldPath).toEqual(["sda"]);
    expect(internals(page)._focusYamlPath).toEqual(["i2c", "sda"]);
    expect(internals(page)._highlightRange).toEqual({ fromLine: 2, toLine: 2 });
    expect(internals(page)._scrollToHighlight).toBe(true);
  });

  it("pins _selectedFromLine to the section start, as a live caret move would", () => {
    // Line 7 sits in the sensor item instance starting at line 5; the
    // raw line stays in the highlight range only.
    const page = makePage({ line: 7 });
    internals(page)._maybeResolveLineFromUrl();
    expect(internals(page)._selectedFromLine).toBe(5);
    expect(internals(page)._highlightRange).toEqual({ fromLine: 7, toLine: 7 });
  });

  it("a section+line arrival keeps the section and still derives focus", () => {
    const page = makePage({ line: 7, section: "sensor.aht10" });
    internals(page)._maybeResolveLineFromUrl();
    expect(internals(page)._selectedSection).toBe("sensor.aht10");
    expect(internals(page)._focusFieldPath).toEqual(["temperature", "name"]);
    expect(internals(page)._focusYamlPath).toEqual(["sensor", 0, "temperature", "name"]);
  });

  it("a section that disagrees with the line derives nothing", () => {
    const page = makePage({ line: 2, section: "sensor.aht10" });
    internals(page)._maybeResolveLineFromUrl();
    expect(internals(page)._selectedSection).toBe("sensor.aht10");
    expect(internals(page)._focusFieldPath).toBeUndefined();
    expect(internals(page)._focusYamlPath).toBeUndefined();
  });

  it("consumes the intent — a later _loadYaml (board swap) can't re-derive", () => {
    const page = makePage({ line: 2 });
    internals(page)._maybeResolveLineFromUrl();
    expect(internals(page)._pendingUrlLine).toBeUndefined();
    internals(page)._focusFieldPath = undefined;
    internals(page)._focusYamlPath = undefined;
    internals(page)._maybeResolveLineFromUrl();
    expect(internals(page)._focusFieldPath).toBeUndefined();
    expect(internals(page)._focusYamlPath).toBeUndefined();
  });

  it("keeps the intent pending while the YAML hasn't loaded", () => {
    const page = makePage({ line: 2 });
    internals(page)._yaml = "";
    internals(page)._maybeResolveLineFromUrl();
    expect(internals(page)._pendingUrlLine).toBe(2);
    internals(page)._yaml = YAML;
    internals(page)._maybeResolveLineFromUrl();
    expect(internals(page)._focusFieldPath).toEqual(["sda"]);
  });

  it("no line param is a no-op", () => {
    const page = makePage({ section: "i2c" });
    internals(page)._maybeResolveLineFromUrl();
    expect(internals(page)._focusFieldPath).toBeUndefined();
    expect(internals(page)._highlightRange).toBeNull();
  });
});
