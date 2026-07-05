/**
 * @vitest-environment happy-dom
 *
 * The "All" page size (sentinel 0): the translation feeds TanStack a
 * real row-count size (floored at 1), and the mounted table renders
 * every row on one page while a normal size paginates (discussion #3682).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/spinner/spinner.js", () => ({}));
vi.mock("../../../src/components/dashboard/table-column-toggle.js", () => ({}));
vi.mock("../../../src/components/dashboard/table-row-menu.js", () => ({}));

import type { ConfiguredDevice } from "../../../src/api/types/devices.js";
import { ESPHomeDeviceTable } from "../../../src/components/dashboard/device-table.js";
import {
  ALL_PAGE_SIZE,
  effectiveTablePageSize,
} from "../../../src/components/dashboard/pagination.js";

describe("effectiveTablePageSize", () => {
  it("passes a normal page size through unchanged", () => {
    expect(effectiveTablePageSize(25, 100)).toBe(25);
  });

  it("expands the All sentinel to the row count (fits every row on page 0)", () => {
    expect(effectiveTablePageSize(ALL_PAGE_SIZE, 30)).toBe(30);
  });

  it("floors at 1 so 0 never reaches TanStack on an empty dataset", () => {
    expect(effectiveTablePageSize(ALL_PAGE_SIZE, 0)).toBe(1);
  });
});

function makeDevices(n: number): ConfiguredDevice[] {
  return Array.from({ length: n }, (_, i) => ({
    name: `demo-${i}`,
    friendly_name: `Demo ${i}`,
    configuration: `demo-${i}.yaml`,
    state: "ONLINE",
    address: `demo-${i}.local`,
    ip: "",
    ip_addresses: [],
    mac_address: "",
    target_platform: "ESP32",
    deployed_version: "",
    build_size_bytes: 0,
    comment: "",
    area: "",
    labels: [],
    has_pending_changes: false,
    update_available: false,
    api_enabled: true,
    api_encrypted: false,
    api_encryption_active: null,
  })) as unknown as ConfiguredDevice[];
}

async function mount(
  count: number,
  initialPageSize: number
): Promise<ESPHomeDeviceTable> {
  const el = new ESPHomeDeviceTable();
  el.devices = makeDevices(count);
  el.initialPageSize = initialPageSize;
  document.body.appendChild(el);
  await el.updateComplete;
  await el.updateComplete;
  return el;
}

const rowCount = (el: ESPHomeDeviceTable) =>
  el.shadowRoot!.querySelectorAll("tbody tr[data-configuration]").length;
const pageSizeAttr = (el: ESPHomeDeviceTable) =>
  el.shadowRoot!.querySelector("esphome-table-pagination")?.getAttribute("page-size");

describe("device-table All rendering", () => {
  it("paginates at a normal page size (25 of 30 rows)", async () => {
    const el = await mount(30, 25);
    expect(rowCount(el)).toBe(25);
    expect(pageSizeAttr(el)).toBe("25");
  });

  it("renders every row on one page when All is selected", async () => {
    const el = await mount(30, ALL_PAGE_SIZE);
    expect(rowCount(el)).toBe(30);
    expect(pageSizeAttr(el)).toBe("0");
  });
});
