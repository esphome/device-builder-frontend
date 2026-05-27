/**
 * Pins the shared device sort helpers used by the dashboard's
 * card grid, list view, and discovery list so all three surfaces
 * order rows by what they display. #946.
 */
import { describe, expect, it } from "vitest";
import { DEVICE_SORT_COLLATOR, deviceSortKey } from "../../src/util/device-sort.js";

type SortInput = Parameters<typeof deviceSortKey>[0];

const compare = (a: SortInput, b: SortInput): number =>
  DEVICE_SORT_COLLATOR.compare(deviceSortKey(a), deviceSortKey(b));

describe("deviceSortKey", () => {
  it("prefers friendly_name over the YAML hostname", () => {
    // YAML hostnames sort opposite to friendly names; the displayed
    // value (friendly name) has to win.
    const office = { friendly_name: "Office Light", name: "zzz-office" };
    const living = { friendly_name: "Living Room Sensor", name: "aaa-living" };
    expect(compare(living, office)).toBeLessThan(0);
    expect(compare(office, living)).toBeGreaterThan(0);
  });

  it("falls back to the YAML hostname when friendly_name is empty", () => {
    const a = { friendly_name: "", name: "aaa-host" };
    const b = { friendly_name: "", name: "bbb-host" };
    expect(compare(a, b)).toBeLessThan(0);
    expect(compare(b, a)).toBeGreaterThan(0);
  });

  it("falls back to configuration when both names are empty", () => {
    // Defensive third fallback for the card grid (``ConfiguredDevice``
    // carries a ``configuration`` filename even on freshly-created
    // devices that haven't set ``name`` yet).
    const a = { friendly_name: "", name: "", configuration: "aaa.yaml" };
    const b = { friendly_name: "", name: "", configuration: "bbb.yaml" };
    expect(compare(a, b)).toBeLessThan(0);
  });
});

describe("DEVICE_SORT_COLLATOR", () => {
  it("orders numbered names naturally (numeric: true)", () => {
    const s2 = { friendly_name: "Sensor 2" };
    const s10 = { friendly_name: "Sensor 10" };
    expect(compare(s2, s10)).toBeLessThan(0);
  });

  it("treats case differences as equal (sensitivity: base)", () => {
    const lower = { friendly_name: "living" };
    const upper = { friendly_name: "Living" };
    expect(compare(lower, upper)).toBe(0);
  });
});
