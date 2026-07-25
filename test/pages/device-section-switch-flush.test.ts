/**
 * @vitest-environment happy-dom
 *
 * Pins the section-switch guard's flush barrier: the switch action
 * must not run until the active section's flushPending resolves, so
 * an automation editor's in-flight upsert can dispatch yaml-draft
 * from an element that is still in the tree.
 */
import { describe, expect, it, vi } from "vitest";

import "./_mock-device-children.js";

import { ESPHomePageDevice } from "../../src/pages/device.js";
import type { SectionEditor } from "../../src/components/device/section-editor.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const internals = (page: ESPHomePageDevice) => page as any;

/** Stub Node.isConnected — attaching the real page element would run
 *  its full connectedCallback against a mockless backend. */
const setConnected = (page: ESPHomePageDevice, value: boolean) =>
  Object.defineProperty(page, "isConnected", { value, configurable: true });

describe("section-switch flush barrier", () => {
  it("defers the switch until an async flushPending resolves", async () => {
    const page = new ESPHomePageDevice();
    setConnected(page, true);
    let resolveFlush!: () => void;
    const editor: SectionEditor = {
      dirty: true,
      flushPending: () =>
        new Promise<void>((resolve) => {
          resolveFlush = resolve;
        }),
      reload: () => {},
    };
    internals(page)._activeSection = editor;

    const order: string[] = [];
    const switching = internals(page)._guardSectionSwitch(() => {
      order.push("action");
    }) as Promise<void>;
    order.push("returned");

    await Promise.resolve();
    expect(order).toEqual(["returned"]);

    resolveFlush();
    await switching;
    expect(order).toEqual(["returned", "action"]);
  });

  it("runs the action synchronously with no active section", async () => {
    const page = new ESPHomePageDevice();
    internals(page)._activeSection = null;
    const action = vi.fn();
    const switching = internals(page)._guardSectionSwitch(action) as Promise<void>;
    // No microtask hop: an async function runs synchronously up to
    // its first await, and the no-flush path has none.
    expect(action).toHaveBeenCalledOnce();
    await switching;
  });

  it("still switches when the flush rejects", async () => {
    const page = new ESPHomePageDevice();
    setConnected(page, true);
    internals(page)._activeSection = {
      dirty: true,
      flushPending: () => Promise.reject(new Error("upsert failed")),
      reload: () => {},
    } satisfies SectionEditor;
    const action = vi.fn();
    await internals(page)._guardSectionSwitch(action);
    expect(action).toHaveBeenCalledOnce();
  });

  it("runs the action synchronously after a sync flush (component editor shape)", async () => {
    const page = new ESPHomePageDevice();
    const flushPending = vi.fn();
    internals(page)._activeSection = {
      dirty: false,
      flushPending,
      reload: () => {},
    } satisfies SectionEditor;
    const action = vi.fn();
    const switching = internals(page)._guardSectionSwitch(action) as Promise<void>;
    expect(flushPending).toHaveBeenCalledOnce();
    // No microtask hop: a void-returning flush must not defer the
    // switch, or the cursor-driven paths become re-entrant.
    expect(action).toHaveBeenCalledOnce();
    await switching;
  });

  it("a later switch supersedes one queued behind the flush", async () => {
    const page = new ESPHomePageDevice();
    setConnected(page, true);
    const resolvers: (() => void)[] = [];
    internals(page)._activeSection = {
      dirty: true,
      flushPending: () =>
        new Promise<void>((resolve) => {
          resolvers.push(resolve);
        }),
      reload: () => {},
    } satisfies SectionEditor;

    const first = vi.fn();
    const second = vi.fn();
    // Both callers pass their dedupe against the same pre-switch
    // selection (it only advances inside the action), so both reach
    // the guard; only the newest may run.
    const switching1 = internals(page)._guardSectionSwitch(first) as Promise<void>;
    const switching2 = internals(page)._guardSectionSwitch(second) as Promise<void>;

    resolvers.forEach((r) => r());
    await Promise.all([switching1, switching2]);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });

  it("composing actions queued behind one flush all land (Back pops twice)", async () => {
    const page = new ESPHomePageDevice();
    setConnected(page, true);
    const resolvers: (() => void)[] = [];
    internals(page)._activeSection = {
      dirty: true,
      flushPending: () =>
        new Promise<void>((resolve) => {
          resolvers.push(resolve);
        }),
      reload: () => {},
    } satisfies SectionEditor;

    const pops: number[] = [];
    const press = (n: number) =>
      internals(page)._guardSectionSwitch(() => pops.push(n), {
        compose: true,
      }) as Promise<void>;
    const p1 = press(1);
    const p2 = press(2);

    resolvers.forEach((r) => r());
    await Promise.all([p1, p2]);
    expect(pops).toEqual([1, 2]);
  });

  it("a composing action still supersedes a pending absolute switch", async () => {
    const page = new ESPHomePageDevice();
    setConnected(page, true);
    const resolvers: (() => void)[] = [];
    internals(page)._activeSection = {
      dirty: true,
      flushPending: () =>
        new Promise<void>((resolve) => {
          resolvers.push(resolve);
        }),
      reload: () => {},
    } satisfies SectionEditor;

    const absolute = vi.fn();
    const back = vi.fn();
    const s1 = internals(page)._guardSectionSwitch(absolute) as Promise<void>;
    const s2 = internals(page)._guardSectionSwitch(back, {
      compose: true,
    }) as Promise<void>;

    resolvers.forEach((r) => r());
    await Promise.all([s1, s2]);
    expect(absolute).not.toHaveBeenCalled();
    expect(back).toHaveBeenCalledOnce();
  });

  it("a caret returning home cancels the switch queued behind the flush", async () => {
    const page = new ESPHomePageDevice();
    setConnected(page, true);
    let resolveFlush!: () => void;
    internals(page)._activeSection = {
      dirty: true,
      flushPending: () =>
        new Promise<void>((resolve) => {
          resolveFlush = resolve;
        }),
      reload: () => {},
    } satisfies SectionEditor;
    // Two top-level sections; the selection sits on i2c (line 1).
    internals(page)._yaml = [
      "i2c:",
      "  sda: 1",
      "sensor:",
      "  - platform: aht10",
      "",
    ].join("\n");
    internals(page)._savedYaml = internals(page)._yaml;
    internals(page)._knownTopLevelKeys = new Set(["i2c", "sensor"]);
    internals(page)._selectedSection = "i2c";
    internals(page)._selectedFromLine = 1;

    const cursor = (line: number) =>
      internals(page)._onYamlCursorLine(
        new CustomEvent("yaml-cursor-line", {
          detail: { line, path: [], viaEdit: false },
        })
      );
    // Caret moves into sensor — cross-section, queued behind the flush.
    cursor(4);
    // …and returns home to the exact block it left before it resolves.
    cursor(2);

    resolveFlush();
    await new Promise((r) => setTimeout(r));
    expect(internals(page)._selectedSection).toBe("i2c");
    expect(internals(page)._selectedFromLine).toBe(1);
  });

  it("re-clicking the displayed section cancels the switch queued behind the flush", async () => {
    const page = new ESPHomePageDevice();
    setConnected(page, true);
    let resolveFlush!: () => void;
    internals(page)._activeSection = {
      dirty: true,
      flushPending: () =>
        new Promise<void>((resolve) => {
          resolveFlush = resolve;
        }),
      reload: () => {},
    } satisfies SectionEditor;
    internals(page)._selectedSection = "i2c";
    internals(page)._selectedFromLine = 1;

    const select = (sectionKey: string, fromLine: number) =>
      internals(page)._onSectionSelect(
        new CustomEvent("section-select", { detail: { sectionKey, fromLine } })
      );
    // Click sensor — cross-section, queued behind the flush…
    select("sensor", 3);
    // …then click the still-displayed i2c again before it resolves.
    select("i2c", 1);

    resolveFlush();
    await new Promise((r) => setTimeout(r));
    expect(internals(page)._selectedSection).toBe("i2c");
    expect(internals(page)._selectedFromLine).toBe(1);
  });

  it("closes the drawer before the flush barrier (mobile tap feedback)", async () => {
    const page = new ESPHomePageDevice();
    setConnected(page, true);
    let resolveFlush!: () => void;
    internals(page)._activeSection = {
      dirty: true,
      flushPending: () =>
        new Promise<void>((resolve) => {
          resolveFlush = resolve;
        }),
      reload: () => {},
    } satisfies SectionEditor;
    internals(page)._selectedSection = "i2c";
    internals(page)._selectedFromLine = 1;
    internals(page)._drawerOpen = true;

    internals(page)._onSectionSelect(
      new CustomEvent("section-select", {
        detail: { sectionKey: "sensor.aht10", fromLine: 3 },
      })
    );
    // Chrome, not selection state: the close must not wait on the
    // barrier, or the mobile tap gets no acknowledgement.
    expect(internals(page)._drawerOpen).toBe(false);

    resolveFlush();
    await new Promise((r) => setTimeout(r));
  });

  it("re-resolves the target section's line against the buffer the flush settled", async () => {
    const page = new ESPHomePageDevice();
    setConnected(page, true);
    let resolveFlush!: () => void;
    internals(page)._activeSection = {
      dirty: true,
      flushPending: () =>
        new Promise<void>((resolve) => {
          resolveFlush = resolve;
        }),
      reload: () => {},
    } satisfies SectionEditor;
    internals(page)._yaml = ["i2c:", "  sda: 1", "sensor:", "  - platform: aht10"].join(
      "\n"
    );
    internals(page)._savedYaml = internals(page)._yaml;
    internals(page)._knownTopLevelKeys = new Set(["i2c", "sensor"]);
    internals(page)._selectedSection = "i2c";
    internals(page)._selectedFromLine = 1;

    // Caret clicks into sensor (line 3 pre-flush) — queued behind the flush.
    internals(page)._onYamlCursorLine(
      new CustomEvent("yaml-cursor-line", {
        detail: { line: 4, path: [], viaEdit: false },
      })
    );
    // The flush's upsert grows the i2c block, shifting sensor to line 5.
    internals(page)._yaml = [
      "i2c:",
      "  sda: 1",
      "  scl: 0",
      "  frequency: 100khz",
      "sensor:",
      "  - platform: aht10",
    ].join("\n");

    resolveFlush();
    await new Promise((r) => setTimeout(r));
    expect(internals(page)._selectedSection).toBe("sensor.aht10");
    // The post-flush coordinate (platform item now on line 6), not
    // the pre-flush 4.
    expect(internals(page)._selectedFromLine).toBe(6);
  });

  it("re-resolves a navigator click's line against the buffer the flush settled", async () => {
    const page = new ESPHomePageDevice();
    setConnected(page, true);
    let resolveFlush!: () => void;
    internals(page)._activeSection = {
      dirty: true,
      flushPending: () =>
        new Promise<void>((resolve) => {
          resolveFlush = resolve;
        }),
      reload: () => {},
    } satisfies SectionEditor;
    internals(page)._yaml = ["i2c:", "  sda: 1", "sensor:", "  - platform: aht10"].join(
      "\n"
    );
    internals(page)._selectedSection = "i2c";
    internals(page)._selectedFromLine = 1;

    // Navigator click captured fromLine 4 against the click-time buffer.
    internals(page)._onSectionSelect(
      new CustomEvent("section-select", {
        detail: { sectionKey: "sensor.aht10", fromLine: 4 },
      })
    );
    // The flush's upsert grows the i2c block before the action runs.
    internals(page)._yaml = [
      "i2c:",
      "  sda: 1",
      "  scl: 0",
      "  frequency: 100khz",
      "sensor:",
      "  - platform: aht10",
    ].join("\n");

    resolveFlush();
    await new Promise((r) => setTimeout(r));
    expect(internals(page)._selectedSection).toBe("sensor.aht10");
    expect(internals(page)._selectedFromLine).toBe(6);
  });

  it("re-resolves an automation target's line — the section kind whose flush defers", async () => {
    const page = new ESPHomePageDevice();
    setConnected(page, true);
    let resolveFlush!: () => void;
    internals(page)._activeSection = {
      dirty: true,
      flushPending: () =>
        new Promise<void>((resolve) => {
          resolveFlush = resolve;
        }),
      reload: () => {},
    } satisfies SectionEditor;
    internals(page)._yaml = [
      "i2c:",
      "  sda: 1",
      "binary_sensor:",
      "  - platform: gpio",
      "    id: btn",
      "    on_press:",
      "      - logger.log: hi",
    ].join("\n");
    internals(page)._knownTopLevelKeys = new Set(["i2c", "binary_sensor"]);
    internals(page)._selectedSection = "i2c";
    internals(page)._selectedFromLine = 1;

    // Caret clicks into the on_press block (line 7 pre-flush).
    internals(page)._onYamlCursorLine(
      new CustomEvent("yaml-cursor-line", {
        detail: { line: 7, path: [], viaEdit: false },
      })
    );
    // The flush grows the i2c block by two lines.
    internals(page)._yaml = [
      "i2c:",
      "  sda: 1",
      "  scl: 0",
      "  frequency: 100khz",
      "binary_sensor:",
      "  - platform: gpio",
      "    id: btn",
      "    on_press:",
      "      - logger.log: hi",
    ].join("\n");

    resolveFlush();
    await new Promise((r) => setTimeout(r));
    expect(internals(page)._selectedSection).toBe("automation:component_on:btn:on_press");
    // on_press sat on line 6 pre-flush; line 8 after the shift.
    expect(internals(page)._selectedFromLine).toBe(8);
  });

  it("re-resolves a multi-instance key onto the instance nearest the snapshot", async () => {
    const page = new ESPHomePageDevice();
    setConnected(page, true);
    let resolveFlush!: () => void;
    internals(page)._activeSection = {
      dirty: true,
      flushPending: () =>
        new Promise<void>((resolve) => {
          resolveFlush = resolve;
        }),
      reload: () => {},
    } satisfies SectionEditor;
    internals(page)._yaml = [
      "i2c:",
      "  sda: 1",
      "sensor:",
      "  - platform: aht10",
      "    name: one",
      "    id: a",
      "  - platform: aht10",
      "    name: two",
      "    id: b",
    ].join("\n");
    internals(page)._knownTopLevelKeys = new Set(["i2c", "sensor"]);
    internals(page)._selectedSection = "i2c";
    internals(page)._selectedFromLine = 1;

    // Caret clicks inside the second instance (fromLine 7 pre-flush).
    internals(page)._onYamlCursorLine(
      new CustomEvent("yaml-cursor-line", {
        detail: { line: 8, path: [], viaEdit: false },
      })
    );
    // The flush grows the i2c block by one line — smaller than half
    // the inter-instance gap, so nearest-line stays exact.
    internals(page)._yaml = [
      "i2c:",
      "  sda: 1",
      "  scl: 0",
      "sensor:",
      "  - platform: aht10",
      "    name: one",
      "    id: a",
      "  - platform: aht10",
      "    name: two",
      "    id: b",
    ].join("\n");

    resolveFlush();
    await new Promise((r) => setTimeout(r));
    // The second instance (now line 8) wins, not the first (line 5).
    expect(internals(page)._selectedFromLine).toBe(8);
  });

  it("Back re-resolves the restored history entry against the settled buffer", async () => {
    const page = new ESPHomePageDevice();
    setConnected(page, true);
    let resolveFlush!: () => void;
    internals(page)._activeSection = {
      dirty: true,
      flushPending: () =>
        new Promise<void>((resolve) => {
          resolveFlush = resolve;
        }),
      reload: () => {},
    } satisfies SectionEditor;
    internals(page)._yaml = ["i2c:", "  sda: 1", "sensor:", "  - platform: aht10"].join(
      "\n"
    );
    internals(page)._selectedSection = "sensor.aht10";
    internals(page)._selectedFromLine = 4;
    // History recorded sensor's old coordinate against an older buffer.
    internals(page)._sectionHistory = [{ key: "sensor.aht10", fromLine: 4 }];

    internals(page)._onBack();
    // The flush grows the i2c block before the pop lands.
    internals(page)._yaml = [
      "i2c:",
      "  sda: 1",
      "  scl: 0",
      "sensor:",
      "  - platform: aht10",
    ].join("\n");

    resolveFlush();
    await new Promise((r) => setTimeout(r));
    expect(internals(page)._selectedSection).toBe("sensor.aht10");
    expect(internals(page)._selectedFromLine).toBe(5);
  });

  it("Back leaves the line unset when the restored key vanished mid-flush", async () => {
    const page = new ESPHomePageDevice();
    setConnected(page, true);
    let resolveFlush!: () => void;
    internals(page)._activeSection = {
      dirty: true,
      flushPending: () =>
        new Promise<void>((resolve) => {
          resolveFlush = resolve;
        }),
      reload: () => {},
    } satisfies SectionEditor;
    internals(page)._yaml = ["i2c:", "  sda: 1", "logger:", "  level: DEBUG"].join("\n");
    internals(page)._selectedSection = "i2c";
    internals(page)._selectedFromLine = 1;
    // History points at a section the flush is about to remove; its
    // old line now holds an unrelated section.
    internals(page)._sectionHistory = [{ key: "sensor.aht10", fromLine: 3 }];

    internals(page)._onBack();
    resolveFlush();
    await new Promise((r) => setTimeout(r));

    expect(internals(page)._selectedSection).toBe("sensor.aht10");
    // Unset, not the stale 3 — downstream resolution must fall back
    // to the key rather than the logger section sitting on line 3.
    expect(internals(page)._selectedFromLine).toBeUndefined();
  });

  it("skips the action when the page unmounts during the flush", async () => {
    const page = new ESPHomePageDevice();
    let resolveFlush!: () => void;
    internals(page)._activeSection = {
      dirty: true,
      flushPending: () =>
        new Promise<void>((resolve) => {
          resolveFlush = resolve;
        }),
      reload: () => {},
    } satisfies SectionEditor;
    setConnected(page, true);
    const action = vi.fn();
    const switching = internals(page)._guardSectionSwitch(action) as Promise<void>;

    // The user leaves the device page while the flush is in flight; a
    // late action would replaceState on whatever URL they landed on.
    setConnected(page, false);

    resolveFlush();
    await switching;
    expect(action).not.toHaveBeenCalled();
  });
});
