/**
 * @vitest-environment happy-dom
 *
 * Pins the #1038 fix: every column renders the same "no data" placeholder
 * (muted proportional em dash), instead of embedding the dash in a
 * column's value font where monospace made it render as a narrow,
 * hyphen-looking glyph. Populated cells keep their own font.
 */
import type { CellContext } from "@tanstack/lit-table";
import { type TemplateResult } from "lit";
import { describe, expect, it } from "vitest";
import {
  createDeviceColumns,
  type DeviceRow,
} from "../../../src/components/dashboard/table-columns.js";
import { identityLocalize, renderInto } from "../../_dom.js";

const columns = createDeviceColumns(identityLocalize);

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

function renderActionsCell(rowOverrides: Partial<DeviceRow> = {}): TemplateResult {
  const col = columns.find((c) => "id" in c && c.id === "actions");
  if (!col?.cell || typeof col.cell !== "function") {
    throw new Error("no cell renderer for actions column");
  }
  const row = {
    busy: false,
    showUpdate: false,
    showModified: false,
    _device: {
      web_port: null,
      current_version: "",
      runtime_state: { deployed_version: "" },
    },
    ...rowOverrides,
  } as unknown as DeviceRow;
  const info = { row: { original: row } } as unknown as CellContext<DeviceRow, unknown>;
  return col.cell(info) as TemplateResult;
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

describe("device table actions", () => {
  it("renders the edit pencil with the accent (action) color", () => {
    const container = renderInto(renderActionsCell());
    const edit = container.querySelector(".cell-action-btn--edit");
    expect(edit).not.toBeNull();
    expect(edit?.classList.contains("cell-action-btn--accent")).toBe(true);
  });
});

function clickInstallAction(container: HTMLElement): {
  fired: string[];
  details: unknown[];
} {
  const btn = container.querySelector<HTMLButtonElement>(".cell-action-btn--install");
  expect(btn).not.toBeNull();
  expect(btn!.disabled).toBe(false);
  const fired: string[] = [];
  const details: unknown[] = [];
  for (const name of ["show-progress", "install-device", "update-device"]) {
    container.addEventListener(name, (e) => {
      fired.push(name);
      details.push((e as CustomEvent).detail);
    });
  }
  btn!.click();
  return { fired, details };
}

describe("device table busy install/update actions", () => {
  it("busy install button stays enabled and dispatches show-progress for its own device", () => {
    const device = {
      web_port: null,
      current_version: "",
      runtime_state: { deployed_version: "" },
    } as unknown as DeviceRow["_device"];
    const container = renderInto(
      renderActionsCell({ busy: true, showModified: true, _device: device })
    );
    const { fired, details } = clickInstallAction(container);
    expect(fired).toEqual(["show-progress"]);
    // The event carries the row's own device, so with several jobs running
    // the dashboard opens this row's job, not another device's.
    expect(details[0]).toBe(device);
  });

  it("busy update button stays enabled and dispatches show-progress", () => {
    const container = renderInto(renderActionsCell({ busy: true, showUpdate: true }));
    expect(clickInstallAction(container).fired).toEqual(["show-progress"]);
  });

  it("busy row keeps Edit clickable", () => {
    // Edit only navigates; the editor is designed for mid-job use (#1196).
    const container = renderInto(renderActionsCell({ busy: true }));
    expect(
      container.querySelector<HTMLButtonElement>(".cell-action-btn--edit")!.disabled
    ).toBe(false);
  });

  it("idle install button dispatches install-device", () => {
    const container = renderInto(renderActionsCell({ busy: false, showModified: true }));
    expect(clickInstallAction(container).fired).toEqual(["install-device"]);
  });

  it("idle update button dispatches update-device", () => {
    const container = renderInto(
      renderActionsCell({
        busy: false,
        showUpdate: true,
        _device: {
          web_port: null,
          current_version: "2026.6.0",
          runtime_state: { deployed_version: "2026.5.0" },
        } as unknown as DeviceRow["_device"],
      })
    );
    expect(clickInstallAction(container).fired).toEqual(["update-device"]);
  });
});

function renderNameCell(rowOverrides: Partial<DeviceRow> = {}): TemplateResult {
  const col = columns.find((c) => "accessorKey" in c && c.accessorKey === "name");
  if (!col?.cell || typeof col.cell !== "function") {
    throw new Error("no cell renderer for name column");
  }
  const row = {
    name: "kitchen",
    friendly_name: "Kitchen",
    showModified: false,
    showUpdate: false,
    hasPendingChanges: false,
    api_enabled: false,
    api_encrypted: false,
    api_encryption_active: null,
    _device: { web_port: null },
    ...rowOverrides,
  } as unknown as DeviceRow;
  const info = { row: { original: row } } as unknown as CellContext<DeviceRow, unknown>;
  return col.cell(info) as TemplateResult;
}

// The encryption lock reads the raw has_pending_changes, the modified dot reads
// the mDNS-gated flag — so for an mDNS-dark, hash-pending, encrypted device the
// table agrees with the drawer's raw-flag badge instead of diverging (#1037).
describe("name-cell encryption indicator uses the raw pending flag", () => {
  it("shows encryption-pending but hides the modified dot when the gate is off", () => {
    const container = renderInto(
      renderNameCell({
        hasPendingChanges: true, // raw: local edit not yet flashed
        showModified: false, // gated off: mDNS dark + hash-driven pending
        api_enabled: true,
        api_encrypted: true,
        api_encryption_active: null,
      })
    );
    expect(container.querySelector(".cell-encryption")).not.toBeNull();
    expect(container.querySelector(".cell-indicator--modified")).toBeNull();
  });
});
