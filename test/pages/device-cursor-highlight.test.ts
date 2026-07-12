/**
 * @vitest-environment happy-dom
 *
 * Pins that the block highlight is a navigator/form affordance only: a caret
 * move into another section clears the stranded highlight instead of leaving
 * it on the previously clicked component (esphome/device-builder#1885), and a
 * hand edit in the YAML pane drops an active highlight rather than letting it
 * go stale against the growing section.
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

function clickYamlLine(
  page: ESPHomePageDevice,
  line: number,
  path: string[] = [],
  indexedPath?: (string | number)[]
) {
  internals(page)._onYamlCursorLine(
    new CustomEvent("yaml-cursor-line", { detail: { line, path, indexedPath } })
  );
}

/** Set a navigator-style block highlight through the event path. */
function highlightViaNavigator(
  page: ESPHomePageDevice,
  fromLine: number,
  toLine: number
) {
  internals(page)._onYamlHighlight(
    new CustomEvent("yaml-highlight", {
      detail: { range: { fromLine, toLine }, scroll: false },
    })
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

  it("clears the stranded highlight when the caret crosses into another section", () => {
    const page = makePage();
    clickYamlLine(page, 2); // select i2c (as the navigator click would)
    highlightViaNavigator(page, 1, 3); // navigator click on i2c
    clickYamlLine(page, 3); // caret inside i2c: same section, highlight stays
    expect(internals(page)._highlightRange).toEqual({ fromLine: 1, toLine: 3 });

    clickYamlLine(page, 5); // sensor: -> aht10 list item
    expect(internals(page)._selectedSection).not.toBe("i2c");
    // The #1885 regression left this on i2c; the highlight must not disagree
    // with the navigator selection — it clears instead of following the caret.
    expect(internals(page)._highlightRange).toBeNull();
  });

  it("does not touch the highlight on an intra-section caret move", () => {
    const page = makePage();
    clickYamlLine(page, 5); // select the aht10 item (as the navigator click would)
    highlightViaNavigator(page, 5, 7); // navigator click on the aht10 item
    const first = internals(page)._highlightRange;
    expect(first).toEqual({ fromLine: 5, toLine: 7 });

    clickYamlLine(page, 6); // still inside the same list item
    // Same object identity: the same-section early return never touched it.
    expect(internals(page)._highlightRange).toBe(first);
  });

  it("leaves highlight and selection on the old section when the guard vetoes", () => {
    const page = makePage();
    clickYamlLine(page, 2); // select i2c
    highlightViaNavigator(page, 1, 3);
    const before = internals(page)._highlightRange;
    expect(before).toEqual({ fromLine: 1, toLine: 3 });

    vi.spyOn(internals(page), "_guardSectionSwitch").mockImplementation(() => {});
    clickYamlLine(page, 5); // would move to sensor, but vetoed

    expect(internals(page)._selectedSection).toBe("i2c");
    expect(internals(page)._highlightRange).toBe(before);
  });

  it("drops an active highlight on a hand edit in the YAML pane", () => {
    const page = makePage();
    highlightViaNavigator(page, 1, 3);
    expect(internals(page)._highlightRange).toEqual({ fromLine: 1, toLine: 3 });

    internals(page)._onYamlUserEdit();

    expect(internals(page)._highlightRange).toBeNull();
  });

  it("hand edit with no active highlight is a no-op", () => {
    const page = makePage();
    const spy = vi.spyOn(internals(page), "_setHighlight");

    internals(page)._onYamlUserEdit();

    expect(spy).not.toHaveBeenCalled();
    expect(internals(page)._highlightRange).toBeNull();
  });

  it("an active error-jump highlight survives a cross-section caret move", () => {
    // Clicking elsewhere isn't a fix: the error marker stays until the
    // next diagnostics pass clears it, same as for hand edits.
    const page = makePage();
    clickYamlLine(page, 2); // select i2c
    internals(page)._setHighlight({ fromLine: 2, toLine: 2 }, true, true);

    clickYamlLine(page, 5); // cross into sensor

    expect(internals(page)._selectedSection).not.toBe("i2c");
    expect(internals(page)._highlightRange).toEqual({ fromLine: 2, toLine: 2 });
    expect(internals(page)._errorHighlight).toBe("active");
  });

  it("captures the indexed cursor path on cross- and same-section moves", () => {
    const page = makePage();
    clickYamlLine(page, 5, ["sensor"], ["sensor", 0, "platform"]); // cross-section
    expect(internals(page)._focusYamlPath).toEqual(["sensor", 0, "platform"]);

    clickYamlLine(page, 6, ["sensor", "temperature"], ["sensor", 0, "temperature"]);
    expect(internals(page)._focusYamlPath).toEqual(["sensor", 0, "temperature"]);
  });

  it("an active error-jump highlight survives a hand edit", () => {
    // The error marker must stay visible while the user fixes the line;
    // only the next diagnostics pass clears it (the active → edited →
    // clear-on-lint lifecycle).
    const page = makePage();
    internals(page)._setHighlight({ fromLine: 2, toLine: 2 }, true, true);
    expect(internals(page)._errorHighlight).toBe("active");

    internals(page)._onYamlUserEdit();

    expect(internals(page)._highlightRange).toEqual({ fromLine: 2, toLine: 2 });
    expect(internals(page)._errorHighlight).toBe("active");
  });
});
