/**
 * @vitest-environment happy-dom
 *
 * The detour-values snapshot is restored only to the ORIGINAL component on
 * return, never to the dependency's own form mid-detour, or the dependency
 * would inherit the original's `id` and collide (the SPI bus taking the
 * sensor's id).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/dialog/dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/spinner/spinner.js", () => ({}));
vi.mock("../../../src/components/device/add-component-form.js", () => ({}));
vi.mock("../../../src/components/device/component-catalog.js", () => ({}));

import { ESPHomeAddComponentDialog } from "../../../src/components/device/add-component-dialog.js";
import { _clearComponentCache } from "../../../src/util/component-name-cache.js";
import { makeComponentEntry } from "../../util/_make-component-entry.js";

interface Internals {
  _returnTo: unknown;
  _returnValues: Record<string, unknown> | null;
  _selected: unknown;
  _submitting: boolean;
  _api: unknown;
  readonly _restoredValuesForMount: Record<string, unknown> | null;
  _onBack: () => void;
  _onBundleSelected: (e: CustomEvent) => Promise<void>;
}

const make = () => new ESPHomeAddComponentDialog() as unknown as Internals;

afterEach(() => {
  _clearComponentCache();
  vi.clearAllMocks();
});

describe("_restoredValuesForMount", () => {
  it("withholds values while a detour is in flight (dep form mounting)", () => {
    const d = make();
    d._returnValues = { cs_pin: "GPIO5" };
    d._returnTo = { id: "sensor.atm90e32" };
    expect(d._restoredValuesForMount).toBeNull();
  });

  it("restores values once the detour finished (original form re-mounts)", () => {
    const d = make();
    d._returnValues = { cs_pin: "GPIO5" };
    d._returnTo = null;
    expect(d._restoredValuesForMount).toEqual({ cs_pin: "GPIO5" });
  });

  it("is null on a fresh open with no snapshot", () => {
    const d = make();
    d._returnTo = null;
    d._returnValues = null;
    expect(d._restoredValuesForMount).toBeNull();
  });
});

describe("_returnValues lifecycle across detour exits", () => {
  it("preserves the snapshot when backing out of the detour", () => {
    const d = make();
    const original = { id: "sensor.atm90e32" };
    d._returnTo = original;
    d._returnValues = { cs_pin: "GPIO5" };

    d._onBack();

    // Back is treated like a submit-return: original re-mounts with its input.
    expect(d._selected).toBe(original);
    expect(d._returnValues).toEqual({ cs_pin: "GPIO5" });
  });

  it("clears the snapshot when a bundle is picked mid-detour", async () => {
    const first = makeComponentEntry("featured.bw15.x", { name: "X" });
    const d = make();
    d._api = {
      getComponentBodies: vi.fn().mockResolvedValue({ "featured.bw15.x": first }),
    };
    d._returnValues = { cs_pin: "GPIO5" };

    await d._onBundleSelected(
      new CustomEvent("add-bundle", {
        detail: { bundle: { name: "B", component_ids: ["x"] }, boardId: "bw15" },
      })
    );

    expect(d._returnValues).toBeNull();
  });
});
