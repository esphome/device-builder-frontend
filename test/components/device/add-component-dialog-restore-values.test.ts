/**
 * @vitest-environment happy-dom
 *
 * Full `_returnValues` (detour value snapshot) lifecycle. The snapshot is
 * captured when a "+ Add <dep>" detour starts, parked on the detour frame while
 * the dep's own form is up, handed back when that frame pops, and cleared on
 * every other detour exit so it can't bleed onto an unrelated form (an id
 * collision being the worst case).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import "../../_mock-webawesome.js";

vi.mock("../../../src/components/device/add-component-form.js", () => ({}));
vi.mock("../../../src/components/device/component-catalog.js", () => ({}));
vi.mock("sonner-js", () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { ComponentCategory } from "../../../src/api/types/components.js";
import type { DetourFrame } from "../../../src/components/device/add-component-dialog-dep-nav.js";
import { _clearComponentCache } from "../../../src/util/component-name-cache.js";
import { makeComponentEntry } from "../../util/_make-component-entry.js";
import { makeDetourFrame } from "../../util/_make-detour-frame.js";
import {
  makeAddComponentDialogHost,
  navigateToDepEvent,
  setForm,
} from "./_add-component-dialog-host.js";

interface Internals {
  _detourStack: DetourFrame[];
  _returnValues: Record<string, unknown> | null;
  _selected: unknown;
  _bundleQueue: string[];
  _bundleProgress: { current: number; total: number; bundleName: string } | null;
  _onBack: () => void;
  _onNavigateToDep: (e: CustomEvent) => Promise<void>;
  _onBundleSelected: (e: CustomEvent) => Promise<void>;
  _submitComponent: (fields: Record<string, unknown>, notify?: boolean) => Promise<void>;
  _resetDetourState: () => void;
}

const makeDialog = () => makeAddComponentDialogHost<Internals>();

afterEach(() => {
  _clearComponentCache();
  vi.clearAllMocks();
});

describe("_returnValues capture (_onNavigateToDep)", () => {
  it("parks the form's in-progress values on the frame, not the slot", async () => {
    const { d, getComponentBodies } = makeDialog();
    getComponentBodies.mockResolvedValue({ spi: makeComponentEntry("spi") });
    d._selected = makeComponentEntry("sensor.atm90e32");
    setForm(d, { currentValues: { cs_pin: "GPIO5", line_frequency: "60HZ" } });

    await d._onNavigateToDep(navigateToDepEvent("spi"));

    expect(d._detourStack[0].values).toEqual({
      cs_pin: "GPIO5",
      line_frequency: "60HZ",
    });
    // The dep's own form mounts empty.
    expect(d._returnValues).toBeNull();
  });

  it("parks null when no form is mounted", async () => {
    const { d, getComponentBodies } = makeDialog();
    getComponentBodies.mockResolvedValue({ spi: makeComponentEntry("spi") });
    d._selected = makeComponentEntry("sensor.atm90e32");
    d._returnValues = { stale: 1 };
    setForm(d, undefined);

    await d._onNavigateToDep(navigateToDepEvent("spi"));

    expect(d._detourStack[0].values).toBeNull();
    expect(d._returnValues).toBeNull();
  });
});

describe("_returnValues across detour exits", () => {
  it("submit-return hands the frame's snapshot to the restored form", async () => {
    const { d } = makeDialog();
    const original = makeComponentEntry("sensor.atm90e32", { name: "ATM90E32" });
    const dep = makeComponentEntry("spi", { category: ComponentCategory.BUS });
    d._selected = dep;
    d._detourStack = [makeDetourFrame(original, { values: { cs_pin: "GPIO5" } })];

    await d._submitComponent({ id: "spi_1" });

    expect(d._selected).toBe(original);
    expect(d._detourStack).toHaveLength(0);
    expect(d._returnValues).toEqual({ cs_pin: "GPIO5" });
  });

  it("back-out preserves the snapshot and restores the original form", () => {
    const { d } = makeDialog();
    const original = { id: "sensor.atm90e32" };
    d._detourStack = [makeDetourFrame(original, { values: { cs_pin: "GPIO5" } })];

    d._onBack();

    expect(d._selected).toBe(original);
    expect(d._returnValues).toEqual({ cs_pin: "GPIO5" });
  });

  it("picking a bundle mid-detour clears the snapshot", async () => {
    const first = makeComponentEntry("featured.bw15.x", { name: "X" });
    const { d, getComponentBodies } = makeDialog();
    getComponentBodies.mockResolvedValue({ "featured.bw15.x": first });
    d._returnValues = { cs_pin: "GPIO5" };

    await d._onBundleSelected(
      new CustomEvent("add-bundle", {
        detail: { bundle: { name: "B", component_ids: ["x"] }, boardId: "bw15" },
      })
    );

    expect(d._returnValues).toBeNull();
  });

  it("bundle-advance clears the snapshot so it can't bleed onto the next step", async () => {
    const step2 = makeComponentEntry("featured.bw15.b", { name: "B" });
    const { d, getComponentBodies } = makeDialog();
    getComponentBodies.mockResolvedValue({ "featured.bw15.b": step2 });
    d._selected = makeComponentEntry("output.gpio", {
      category: ComponentCategory.OUTPUT,
    });
    d._bundleQueue = ["featured.bw15.b"];
    d._bundleProgress = { current: 1, total: 2, bundleName: "Bundle" };
    d._returnValues = { cs_pin: "GPIO5" };

    await d._submitComponent({ id: "gpio_1" });

    expect(d._selected).toBe(step2);
    expect(d._returnValues).toBeNull();
  });

  it("_resetDetourState clears the snapshot and the whole stack", () => {
    const { d } = makeDialog();
    d._detourStack = [
      makeDetourFrame({ id: "climate.anova" }),
      makeDetourFrame({ id: "ble_client" }),
    ];
    d._returnValues = { cs_pin: "GPIO5" };

    d._resetDetourState();

    expect(d._returnValues).toBeNull();
    expect(d._detourStack).toHaveLength(0);
  });
});
