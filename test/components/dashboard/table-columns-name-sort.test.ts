/**
 * Pins the dashboard list-view Name column sort to follow the
 * displayed value (friendly name, with YAML-hostname fallback) so
 * display key and sort key stay aligned. #946.
 */
import { describe, expect, it } from "vitest";
import {
  NAME_COLLATOR,
  nameSortKey,
  type DeviceRow,
} from "../../../src/components/dashboard/table-columns.js";

const makeRow = (friendly_name: string, name: string): DeviceRow =>
  ({ friendly_name, name }) as DeviceRow;

const compareRows = (a: DeviceRow, b: DeviceRow): number =>
  NAME_COLLATOR.compare(nameSortKey(a), nameSortKey(b));

describe("Name column sort", () => {
  it("sorts by friendly_name when set, not by the YAML hostname", () => {
    // YAML hostnames sort opposite to friendly names; the column
    // displays the friendly name, so the sort has to match that.
    const office = makeRow("Office Light", "zzz-office");
    const living = makeRow("Living Room Sensor", "aaa-living");
    expect(compareRows(living, office)).toBeLessThan(0);
    expect(compareRows(office, living)).toBeGreaterThan(0);
  });

  it("falls back to the YAML hostname when friendly_name is empty", () => {
    const a = makeRow("", "aaa-host");
    const b = makeRow("", "bbb-host");
    expect(compareRows(a, b)).toBeLessThan(0);
    expect(compareRows(b, a)).toBeGreaterThan(0);
  });

  it("orders numbered names naturally (numeric: true)", () => {
    const s2 = makeRow("Sensor 2", "sensor-2");
    const s10 = makeRow("Sensor 10", "sensor-10");
    expect(compareRows(s2, s10)).toBeLessThan(0);
  });

  it("treats case differences as equal (sensitivity: base)", () => {
    const lower = makeRow("living", "x");
    const upper = makeRow("Living", "y");
    expect(compareRows(lower, upper)).toBe(0);
  });
});
