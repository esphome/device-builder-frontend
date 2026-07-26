/**
 * @vitest-environment happy-dom
 *
 * Pins the synchronous section switch (#1479): the swap never waits
 * on a backend round trip — the outgoing editor's flush is kicked
 * fire-and-forget, its draft lands later through the anchor, and the
 * landing re-pins the selection line (#1470).
 */
import { describe, expect, it, vi } from "vitest";

import "./_mock-device-children.js";

import type { SectionEditor } from "../../src/components/device/section-editor.js";
import { ESPHomePageDevice } from "../../src/pages/device.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const internals = (page: ESPHomePageDevice) => page as any;

/** Stub the active section with a flush the test resolves on demand. */
const gateFlush = (page: ESPHomePageDevice) => {
  let resolve!: () => void;
  const flushPending = vi.fn(
    () =>
      new Promise<void>((r) => {
        resolve = r;
      })
  );
  internals(page)._activeSection = {
    dirty: true,
    flushPending,
    reload: () => {},
  } satisfies SectionEditor;
  return { resolve: () => resolve(), flushPending };
};

const select = (page: ESPHomePageDevice, sectionKey: string | null, fromLine?: number) =>
  internals(page)._onSectionSelect(
    new CustomEvent("section-select", { detail: { sectionKey, fromLine } })
  );

describe("synchronous section switch", () => {
  it("lands the switch synchronously while an async flush is in flight", () => {
    const page = new ESPHomePageDevice();
    const { flushPending } = gateFlush(page);
    internals(page)._selectedSection = "i2c";
    internals(page)._selectedFromLine = 1;

    select(page, "sensor.aht10", 3);

    // No await: the selection moved before the flush settled, and
    // the outgoing editor's flush was kicked exactly once.
    expect(internals(page)._selectedSection).toBe("sensor.aht10");
    expect(internals(page)._selectedFromLine).toBe(3);
    expect(flushPending).toHaveBeenCalledTimes(1);
  });

  it("a rejecting flush neither blocks the switch nor leaks a rejection", async () => {
    const page = new ESPHomePageDevice();
    internals(page)._activeSection = {
      dirty: true,
      flushPending: () => Promise.reject(new Error("upsert failed")),
      reload: () => {},
    } satisfies SectionEditor;
    internals(page)._selectedSection = "i2c";

    select(page, "sensor.aht10", 3);

    expect(internals(page)._selectedSection).toBe("sensor.aht10");
    // The rejection is swallowed by the kick (the editor already
    // surfaced its own toast); an unhandled rejection would fail the
    // run via vitest's global handler.
    await new Promise((r) => setTimeout(r));
  });

  it("a still-displayed re-click only closes the drawer", () => {
    const page = new ESPHomePageDevice();
    const { flushPending } = gateFlush(page);
    internals(page)._selectedSection = "i2c";
    internals(page)._selectedFromLine = 1;
    internals(page)._drawerOpen = true;

    select(page, "i2c", 1);

    expect(internals(page)._selectedSection).toBe("i2c");
    expect(internals(page)._drawerOpen).toBe(false);
    expect(flushPending).not.toHaveBeenCalled();
  });

  it("closes the drawer immediately (mobile tap feedback)", () => {
    const page = new ESPHomePageDevice();
    gateFlush(page);
    internals(page)._selectedSection = "i2c";
    internals(page)._drawerOpen = true;

    select(page, "sensor.aht10", 3);

    expect(internals(page)._drawerOpen).toBe(false);
  });

  it("a landing draft re-pins the selection line (#1470)", () => {
    const page = new ESPHomePageDevice();
    page.id = "kitchen.yaml";
    const before = ["i2c:", "  sda: 1", "sensor:", "  - platform: aht10"].join("\n");
    internals(page)._yaml = before;
    internals(page)._selectedSection = "sensor.aht10";
    internals(page)._selectedFromLine = 4;

    // The outgoing editor's upsert grows the i2c block; its anchored
    // draft lands with a matching basis and shifts sensor down.
    internals(page)._onYamlDraft(
      new CustomEvent("yaml-draft", {
        detail: {
          configuration: "kitchen.yaml",
          yaml: [
            "i2c:",
            "  sda: 1",
            "  scl: 0",
            "  frequency: 100khz",
            "sensor:",
            "  - platform: aht10",
          ].join("\n"),
          basedOn: before,
          node: new EventTarget(),
        },
      })
    );

    expect(internals(page)._selectedFromLine).toBe(6);
  });

  it("a landing draft leaves the line unset when the selected key vanished", () => {
    const page = new ESPHomePageDevice();
    page.id = "kitchen.yaml";
    const before = ["i2c:", "  sda: 1", "sensor:", "  - platform: aht10"].join("\n");
    internals(page)._yaml = before;
    internals(page)._selectedSection = "sensor.aht10";
    internals(page)._selectedFromLine = 4;

    internals(page)._onYamlDraft(
      new CustomEvent("yaml-draft", {
        detail: {
          configuration: "kitchen.yaml",
          yaml: ["i2c:", "  sda: 1", "logger:", "  level: DEBUG"].join("\n"),
          basedOn: before,
          node: new EventTarget(),
        },
      })
    );

    // Unset, not the stale 4 — downstream resolution must fall back
    // to the key rather than the logger section on that line.
    expect(internals(page)._selectedFromLine).toBeUndefined();
  });

  it("two Back presses pop two entries synchronously", () => {
    const page = new ESPHomePageDevice();
    const { flushPending } = gateFlush(page);
    internals(page)._yaml = ["i2c:", "  sda: 1", "sensor:", "  - platform: aht10"].join(
      "\n"
    );
    internals(page)._selectedSection = "sensor.aht10";
    internals(page)._selectedFromLine = 4;
    internals(page)._sectionHistory = [
      { key: "i2c", fromLine: 1 },
      { key: "sensor.aht10", fromLine: 4 },
    ];

    internals(page)._onBack();
    internals(page)._onBack();

    expect(internals(page)._selectedSection).toBe("i2c");
    expect(internals(page)._sectionHistory).toEqual([]);
    expect(flushPending).toHaveBeenCalledTimes(2);
  });

  it("Back re-resolves the restored history entry against the live buffer", () => {
    const page = new ESPHomePageDevice();
    // The entry was recorded before the i2c block grew.
    internals(page)._yaml = [
      "i2c:",
      "  sda: 1",
      "  scl: 0",
      "sensor:",
      "  - platform: aht10",
    ].join("\n");
    internals(page)._selectedSection = "i2c";
    internals(page)._selectedFromLine = 1;
    internals(page)._sectionHistory = [{ key: "sensor.aht10", fromLine: 4 }];

    internals(page)._onBack();

    expect(internals(page)._selectedSection).toBe("sensor.aht10");
    expect(internals(page)._selectedFromLine).toBe(5);
  });

  it("Back leaves the line unset when the restored key vanished", () => {
    const page = new ESPHomePageDevice();
    internals(page)._yaml = ["i2c:", "  sda: 1", "logger:", "  level: DEBUG"].join("\n");
    internals(page)._selectedSection = "i2c";
    internals(page)._selectedFromLine = 1;
    internals(page)._sectionHistory = [{ key: "sensor.aht10", fromLine: 3 }];

    internals(page)._onBack();

    expect(internals(page)._selectedSection).toBe("sensor.aht10");
    expect(internals(page)._selectedFromLine).toBeUndefined();
  });

  it("a cursor cross-section click switches synchronously", () => {
    const page = new ESPHomePageDevice();
    const { flushPending } = gateFlush(page);
    internals(page)._yaml = ["i2c:", "  sda: 1", "sensor:", "  - platform: aht10"].join(
      "\n"
    );
    internals(page)._knownTopLevelKeys = new Set(["i2c", "sensor"]);
    internals(page)._selectedSection = "i2c";
    internals(page)._selectedFromLine = 1;

    internals(page)._onYamlCursorLine(
      new CustomEvent("yaml-cursor-line", {
        detail: { line: 4, path: [], viaEdit: false },
      })
    );

    // Click-time coordinates against the click-time buffer; a draft
    // landing later re-pins them (covered above).
    expect(internals(page)._selectedSection).toBe("sensor.aht10");
    expect(internals(page)._selectedFromLine).toBe(4);
    expect(flushPending).toHaveBeenCalledTimes(1);
  });
});
