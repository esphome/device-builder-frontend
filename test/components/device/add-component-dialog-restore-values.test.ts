/**
 * @vitest-environment happy-dom
 *
 * Full `_returnValues` (detour value snapshot) lifecycle. The snapshot is
 * captured when a "+ Add <dep>" detour starts, restored ONLY to the original
 * component on return, and cleared on every other detour exit so it can't
 * bleed onto an unrelated form (an id collision being the worst case).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/dialog/dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/spinner/spinner.js", () => ({}));
vi.mock("../../../src/components/device/add-component-form.js", () => ({}));
vi.mock("../../../src/components/device/component-catalog.js", () => ({}));
vi.mock("sonner-js", () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { ComponentCategory } from "../../../src/api/types/components.js";
import { ESPHomeAddComponentDialog } from "../../../src/components/device/add-component-dialog.js";
import { _clearComponentCache } from "../../../src/util/component-name-cache.js";
import { makeComponentEntry } from "../../util/_make-component-entry.js";

interface Internals {
  _returnTo: unknown;
  _returnValues: Record<string, unknown> | null;
  _selected: unknown;
  _depDomain: string | null;
  _bundleQueue: string[];
  _bundleProgress: { current: number; total: number; bundleName: string } | null;
  readonly _restoredValuesForMount: Record<string, unknown> | null;
  _onBack: () => void;
  _onNavigateToDep: (e: CustomEvent) => Promise<void>;
  _onBundleSelected: (e: CustomEvent) => Promise<void>;
  _submitComponent: (fields: Record<string, unknown>, notify?: boolean) => Promise<void>;
  _resetDetourState: () => void;
}

/** Dialog wired with a stub API so `_submitComponent`/detour paths run. */
function makeDialog() {
  const addComponent = vi.fn().mockResolvedValue({ yaml: "MERGED" });
  const getComponentBodies = vi.fn().mockResolvedValue({});
  const dialog = new ESPHomeAddComponentDialog();
  Object.assign(dialog as unknown as Record<string, unknown>, {
    _api: { addComponent, getComponentBodies },
  });
  dialog.configuration = "foo.yaml";
  dialog.yaml = "esphome:\n  name: foo\n";
  return { d: dialog as unknown as Internals, addComponent, getComponentBodies };
}

/** Override the `@query` `_form` getter for capture tests. */
function setForm(
  d: Internals,
  form: { currentValues: Record<string, unknown> } | undefined
) {
  Object.defineProperty(d, "_form", { value: form, configurable: true });
}

afterEach(() => {
  _clearComponentCache();
  vi.clearAllMocks();
});

describe("_restoredValuesForMount gate", () => {
  it("withholds values while a detour is in flight (dep form mounting)", () => {
    const { d } = makeDialog();
    d._returnValues = { cs_pin: "GPIO5" };
    d._returnTo = { id: "sensor.atm90e32" };
    expect(d._restoredValuesForMount).toBeNull();
  });

  it("restores values once the detour finished (original form re-mounts)", () => {
    const { d } = makeDialog();
    d._returnValues = { cs_pin: "GPIO5" };
    d._returnTo = null;
    expect(d._restoredValuesForMount).toEqual({ cs_pin: "GPIO5" });
  });

  it("is null on a fresh open with no snapshot", () => {
    const { d } = makeDialog();
    d._returnTo = null;
    d._returnValues = null;
    expect(d._restoredValuesForMount).toBeNull();
  });
});

describe("_returnValues capture (_onNavigateToDep)", () => {
  it("snapshots the form's in-progress values before the form unmounts", async () => {
    const { d, getComponentBodies } = makeDialog();
    getComponentBodies.mockResolvedValue({ spi: makeComponentEntry("spi") });
    setForm(d, { currentValues: { cs_pin: "GPIO5", line_frequency: "60HZ" } });
    // Capture is synchronous, before `navigateToDep` swaps `_selected`.
    const p = d._onNavigateToDep(
      new CustomEvent("navigate-to-dep", { detail: { domain: "spi" } })
    );
    expect(d._returnValues).toEqual({ cs_pin: "GPIO5", line_frequency: "60HZ" });
    await p;
  });

  it("snapshots null when no form is mounted", async () => {
    const { d, getComponentBodies } = makeDialog();
    getComponentBodies.mockResolvedValue({ spi: makeComponentEntry("spi") });
    d._returnValues = { stale: 1 };
    setForm(d, undefined);
    const p = d._onNavigateToDep(
      new CustomEvent("navigate-to-dep", { detail: { domain: "spi" } })
    );
    expect(d._returnValues).toBeNull();
    await p;
  });
});

describe("_returnValues across detour exits", () => {
  it("submit-return leaves the snapshot set so the restored form reads it", async () => {
    const { d } = makeDialog();
    const original = makeComponentEntry("sensor.atm90e32", { name: "ATM90E32" });
    const dep = makeComponentEntry("spi", { category: ComponentCategory.BUS });
    d._selected = dep;
    d._returnTo = original;
    d._depDomain = "spi";
    d._returnValues = { cs_pin: "GPIO5" };

    await d._submitComponent({ id: "spi_1" });

    expect(d._selected).toBe(original);
    expect(d._returnTo).toBeNull();
    expect(d._returnValues).toEqual({ cs_pin: "GPIO5" });
  });

  it("back-out preserves the snapshot and restores the original form", () => {
    const { d } = makeDialog();
    const original = { id: "sensor.atm90e32" };
    d._returnTo = original;
    d._returnValues = { cs_pin: "GPIO5" };

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
    d._returnTo = null;
    d._bundleQueue = ["featured.bw15.b"];
    d._bundleProgress = { current: 1, total: 2, bundleName: "Bundle" };
    d._returnValues = { cs_pin: "GPIO5" };

    await d._submitComponent({ id: "gpio_1" });

    expect(d._selected).toBe(step2);
    expect(d._returnValues).toBeNull();
  });

  it("_resetDetourState clears the snapshot", () => {
    const { d } = makeDialog();
    d._returnValues = { cs_pin: "GPIO5" };
    d._resetDetourState();
    expect(d._returnValues).toBeNull();
  });
});
