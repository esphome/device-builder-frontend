/**
 * @vitest-environment happy-dom
 *
 * Pins renderTable feeding the table the collator-sorted device list, so
 * the no-column-sort default order matches the card grid instead of the
 * backend's capitals-first path order (device-builder#1917).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import type { ConfiguredDevice } from "../../../src/api/types/devices.js";
import { DashboardView } from "../../../src/api/types/system.js";
import { renderTable } from "../../../src/components/dashboard/render-content.js";
import { sortDevices } from "../../../src/util/device-sort.js";
import { renderInto } from "../../_dom.js";
import { makeConfiguredDevice } from "../../_make-configured-device.js";
import { makeDashboardHost } from "./_host.js";

// Backend snapshot order: lexicographic by YAML path, capitals first.
const BACKEND_ORDER = ["Garland", "ecu Boiler", "plg Servion"].map((name) =>
  makeConfiguredDevice({
    name,
    friendly_name: name,
    configuration: `${name}.yaml`,
  })
);

function makeHost(devices: ConfiguredDevice[]) {
  return makeDashboardHost({
    _devices: devices,
    _sortedDevices: sortDevices(devices),
    _applyFacetFilters: (list: ConfiguredDevice[]) => list,
    _activeJobs: new Map(),
    _recentJobs: new Map(),
    _tablePageSize: 25,
    _tableSorting: [],
    _tableColumnVisibility: {},
    _selectMode: false,
    _visibleImportableDevices: [],
    _selectedDevices: new Set<string>(),
    _recentlyAdopted: null,
    _view: DashboardView.TABLE,
    _expertMode: false,
    _selectedLabels: [],
    _selectedAreas: [],
    _selectedPlatforms: [],
    _selectedStates: [],
    _selectedUpdateStatus: [],
    _activeFacetCount: 0,
    _computeLabelUsage: () => new Map(),
    _allVisibleSelected: false,
  });
}

describe("renderTable default device order", () => {
  it("passes the collator-sorted list, not the backend snapshot order", () => {
    const container = renderInto(renderTable(makeHost(BACKEND_ORDER)));
    const table = container.querySelector("esphome-device-table") as unknown as {
      devices: ConfiguredDevice[];
    };
    expect(table.devices.map((d) => d.friendly_name)).toEqual([
      "ecu Boiler",
      "Garland",
      "plg Servion",
    ]);
  });
});
