/**
 * @vitest-environment happy-dom
 *
 * The detour-values snapshot is restored only to the ORIGINAL component on
 * return, never to the dependency's own form mid-detour, or the dependency
 * would inherit the original's `id` and collide (the SPI bus taking the
 * sensor's id).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/dialog/dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/spinner/spinner.js", () => ({}));
vi.mock("../../../src/components/device/add-component-form.js", () => ({}));
vi.mock("../../../src/components/device/component-catalog.js", () => ({}));

import { ESPHomeAddComponentDialog } from "../../../src/components/device/add-component-dialog.js";

interface Internals {
  _returnTo: unknown;
  _returnValues: Record<string, unknown> | null;
  readonly _restoredValuesForMount: Record<string, unknown> | null;
}

const make = () => new ESPHomeAddComponentDialog() as unknown as Internals;

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
