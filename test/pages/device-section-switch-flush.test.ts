/**
 * @vitest-environment happy-dom
 *
 * Pins the section-switch guard's flush barrier: the switch action
 * must not run until the active section's flushPending resolves, so
 * an automation editor's in-flight upsert can dispatch yaml-draft
 * from an element that is still in the tree.
 */
import { describe, expect, it, vi } from "vitest";

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
