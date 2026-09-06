/**
 * @vitest-environment happy-dom
 *
 * Cross-section caret moves from the keyboard or the find panel coalesce
 * into one section switch; clicks, edits, same-section moves and navigator
 * selections apply at once and cancel a pending move.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "./_mock-device-children.js";

import type { ESPHomeAPI } from "../../src/api/index.js";
import { ESPHomePageDevice } from "../../src/pages/device.js";

const YAML = [
  "i2c:",
  "  sda: 1",
  "sensor:",
  "  - platform: aht10",
  "switch:",
  "  - platform: gpio",
  "",
].join("\n");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const internals = (page: ESPHomePageDevice) => page as any;

function makePage(): ESPHomePageDevice {
  const page = new ESPHomePageDevice();
  internals(page)._api = {} as ESPHomeAPI;
  page.id = "kitchen.yaml";
  internals(page)._yaml = YAML;
  internals(page)._savedYaml = YAML;
  internals(page)._knownTopLevelKeys = new Set(["i2c", "sensor", "switch"]);
  internals(page)._selectedSection = "i2c";
  internals(page)._selectedFromLine = 1;
  return page;
}

function cursor(
  page: ESPHomePageDevice,
  line: number,
  opts: { viaEdit?: boolean; pointer?: boolean; path?: string[] } = {}
) {
  internals(page)._onYamlCursorLine(
    new CustomEvent("yaml-cursor-line", {
      detail: {
        line,
        path: opts.path ?? [],
        viaEdit: opts.viaEdit ?? false,
        pointer: opts.pointer ?? false,
      },
    })
  );
}

describe("cross-section caret moves coalesce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.history.replaceState(null, "", "/");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("folds a burst of find jumps into one switch to the last target", () => {
    const page = makePage();
    const replace = vi.spyOn(window.history, "replaceState");
    cursor(page, 4);
    cursor(page, 6);
    cursor(page, 4);
    expect(internals(page)._selectedSection).toBe("i2c");
    expect(replace).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(internals(page)._selectedSection).toBe("sensor.aht10");
    expect(internals(page)._selectedFromLine).toBe(4);
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it("an edit onto a known key drops a pending move and switches at once", () => {
    const page = makePage();
    cursor(page, 6);
    cursor(page, 4, { viaEdit: true });
    expect(internals(page)._selectedSection).toBe("sensor.aht10");
    vi.advanceTimersByTime(100);
    expect(internals(page)._selectedSection).toBe("sensor.aht10");
  });

  it("a move back into the current section cancels the pending switch", () => {
    const page = makePage();
    cursor(page, 4);
    cursor(page, 2, { path: ["i2c", "sda"] });
    vi.advanceTimersByTime(100);
    expect(internals(page)._selectedSection).toBe("i2c");
    expect(internals(page)._focusFieldPath).toEqual(["sda"]);
  });

  it("a move onto a line with no section cancels the pending switch", () => {
    const page = makePage();
    cursor(page, 4);
    cursor(page, 99);
    vi.advanceTimersByTime(100);
    expect(internals(page)._selectedSection).toBe("i2c");
  });

  it("re-clicking the selected row cancels a pending move", () => {
    const page = makePage();
    cursor(page, 4);
    internals(page)._onSectionSelect(
      new CustomEvent("section-select", { detail: { sectionKey: "i2c", fromLine: 1 } })
    );
    vi.advanceTimersByTime(100);
    expect(internals(page)._selectedSection).toBe("i2c");
  });

  it("a navigator selection wins over a pending move", () => {
    const page = makePage();
    cursor(page, 4);
    internals(page)._onSectionSelect(
      new CustomEvent("section-select", {
        detail: { sectionKey: "switch.gpio", fromLine: 6 },
      })
    );
    vi.advanceTimersByTime(100);
    expect(internals(page)._selectedSection).toBe("switch.gpio");
  });

  it("resolves the target against the buffer at fire time", () => {
    const page = makePage();
    cursor(page, 6);
    // A draft inserted a line above the target before the window closed.
    internals(page)._yaml = [
      "i2c:",
      "  sda: 1",
      "  scl: 2",
      "sensor:",
      "  - platform: aht10",
      "switch:",
      "  - platform: gpio",
      "",
    ].join("\n");
    vi.advanceTimersByTime(100);
    expect(internals(page)._selectedSection).toBe("switch.gpio");
    expect(internals(page)._selectedFromLine).toBe(7);
  });

  it("clears the pending move on disconnect", () => {
    const page = makePage();
    cursor(page, 4);
    page.disconnectedCallback();
    vi.advanceTimersByTime(100);
    expect(internals(page)._selectedSection).toBe("i2c");
  });
});
