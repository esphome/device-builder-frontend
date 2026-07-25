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

describe("section-switch flush barrier", () => {
  it("defers the switch until an async flushPending resolves", async () => {
    const page = new ESPHomePageDevice();
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

  it("runs the action with no active section", async () => {
    const page = new ESPHomePageDevice();
    internals(page)._activeSection = null;
    const action = vi.fn();
    await internals(page)._guardSectionSwitch(action);
    expect(action).toHaveBeenCalledOnce();
  });

  it("still switches when the flush rejects", async () => {
    const page = new ESPHomePageDevice();
    internals(page)._activeSection = {
      dirty: true,
      flushPending: () => Promise.reject(new Error("upsert failed")),
      reload: () => {},
    } satisfies SectionEditor;
    const action = vi.fn();
    await internals(page)._guardSectionSwitch(action);
    expect(action).toHaveBeenCalledOnce();
  });

  it("runs the action after a sync flush (component editor shape)", async () => {
    const page = new ESPHomePageDevice();
    const flushPending = vi.fn();
    internals(page)._activeSection = {
      dirty: false,
      flushPending,
      reload: () => {},
    } satisfies SectionEditor;
    const action = vi.fn();
    await internals(page)._guardSectionSwitch(action);
    expect(flushPending).toHaveBeenCalledOnce();
    expect(action).toHaveBeenCalledOnce();
  });
});
