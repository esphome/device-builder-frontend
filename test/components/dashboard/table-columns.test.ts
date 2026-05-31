/**
 * Pins the #1038 fix: every column renders the same "no data" placeholder
 * (muted proportional em dash), instead of embedding the dash in a
 * column's value font where monospace made it render as a narrow,
 * hyphen-looking glyph. Populated cells keep their own font.
 */
import type { CellContext } from "@tanstack/lit-table";
import type { TemplateResult } from "lit";
import { describe, expect, it } from "vitest";
import {
  createDeviceColumns,
  type DeviceRow,
} from "../../../src/components/dashboard/table-columns.js";

const columns = createDeviceColumns((key) => key);

function columnByKey(key: string) {
  const col = columns.find((c) => "accessorKey" in c && c.accessorKey === key);
  if (!col?.cell || typeof col.cell !== "function") {
    throw new Error(`no cell renderer for column ${key}`);
  }
  return col.cell;
}

function renderCell(key: string, value: unknown): TemplateResult {
  const cell = columnByKey(key);
  // The data columns only read info.getValue(); a minimal stub suffices.
  const info = { getValue: () => value } as unknown as CellContext<DeviceRow, unknown>;
  return cell(info) as TemplateResult;
}

// Flatten a TemplateResult's static strings AND interpolated values so the
// assertions hold whether the class is a static literal or a binding.
function rendered(t: TemplateResult): string {
  const { strings, values } = t;
  return strings.reduce(
    (acc, s, i) => acc + s + (i < values.length ? String(values[i]) : ""),
    ""
  );
}

const DATA_COLUMNS = ["address", "ip", "version", "comment", "area", "mac_address"];

describe("device table empty-cell placeholder (#1038)", () => {
  for (const key of DATA_COLUMNS) {
    it(`${key}: empty renders the shared muted placeholder, not the value font`, () => {
      const html = rendered(renderCell(key, ""));
      expect(html).toContain("cell-muted");
      expect(html).toContain("—");
      // The placeholder must not inherit the column's value font.
      expect(html).not.toContain("cell-mono");
      expect(html).not.toContain("cell-comment");
    });
  }

  it("labels: empty renders the shared muted placeholder", () => {
    const html = rendered(renderCell("labels", []));
    expect(html).toContain("cell-muted");
    expect(html).toContain("—");
  });

  it("keeps the monospace value font when a value is present", () => {
    const html = rendered(renderCell("ip", "192.168.1.42"));
    expect(html).toContain("cell-mono");
    expect(html).toContain("192.168.1.42");
  });
});
