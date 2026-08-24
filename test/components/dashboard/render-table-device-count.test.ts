/**
 * @vitest-environment happy-dom
 *
 * Pins the table view's device-count row tracking the text search as well
 * as the facets. The table applies the search inside its own global
 * filter, so the count used to reflect facets only (device-builder#2627).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { renderInto } from "../../_dom.js";
import { makeConfiguredDevice } from "../../_make-configured-device.js";
import type { ConfiguredDevice } from "../../../src/api/types/devices.js";
import { DashboardView } from "../../../src/api/types/system.js";
import { renderTable } from "../../../src/components/dashboard/render-content.js";
import {
  clearTourConfiguration,
  setTourActive,
  setTourConfiguration,
} from "../../../src/components/guided-tour/tour-session.js";
import { makeTableHost } from "./_host.js";

const DEVICES = [
  makeConfiguredDevice({
    name: "garland",
    friendly_name: "Garland",
    configuration: "garland.yaml",
    address: "garland.local",
  }),
  makeConfiguredDevice({
    name: "ecu-boiler",
    friendly_name: "ECU Boiler",
    configuration: "ecu-boiler.yaml",
    address: "10.0.0.42",
  }),
  makeConfiguredDevice({
    name: "servion",
    friendly_name: "Servion",
    configuration: "servion.yaml",
    address: "servion.local",
  }),
];

function makeHost(overrides: Record<string, unknown> = {}) {
  return makeTableHost({
    _devices: DEVICES,
    _sortedDevices: DEVICES,
    _view: DashboardView.TABLE,
    ...overrides,
  });
}

function countRow(host: ReturnType<typeof makeHost>): { count: string; text: string } {
  const container = renderInto(renderTable(host));
  const el = container.querySelector(".device-count") as HTMLElement;
  return {
    count: el.querySelector("strong")!.textContent ?? "",
    text: el.textContent ?? "",
  };
}

afterEach(() => {
  setTourActive(false);
  clearTourConfiguration();
});

describe("renderTable device count", () => {
  it("counts every facet-visible device when the search is empty", () => {
    const row = countRow(makeHost());
    expect(row.count).toBe("3");
    expect(row.text).not.toContain("dashboard.search_of");
  });

  it("narrows the count to the devices matching the search", () => {
    const row = countRow(makeHost({ _search: "ecu" }));
    expect(row.count).toBe("1");
    expect(row.text).toContain("dashboard.search_of");
  });

  it("uses the table predicate so an address match is counted", () => {
    expect(countRow(makeHost({ _search: "10.0.0" })).count).toBe("1");
  });

  it("applies the search on top of the facet filter", () => {
    const facetFiltered = DEVICES.filter((d) => d.name !== "ecu-boiler");
    const host = makeHost({
      _search: "on",
      _applyFacetFilters: (_list: ConfiguredDevice[]) => facetFiltered,
    });
    // "Servion" matches, "Garland" doesn't; "ECU Boiler" is hidden by
    // the facet before the search runs.
    expect(countRow(host).count).toBe("1");
  });

  it("leaves the forced guided-tour row out of the count", () => {
    // The facets drop the tour target and includeTourDevice puts it back
    // for the table, which also keeps it visible when it doesn't match
    // the search; the count mirrors the card view and only counts matches.
    setTourConfiguration("garland.yaml");
    setTourActive(true);
    const host = makeHost({
      _search: "ecu",
      _applyFacetFilters: (list: ConfiguredDevice[]) =>
        list.filter((d) => d.configuration !== "garland.yaml"),
    });
    const container = renderInto(renderTable(host));
    const table = container.querySelector("esphome-device-table") as unknown as {
      devices: ConfiguredDevice[];
    };
    expect(table.devices.map((d) => d.configuration)).toContain("garland.yaml");
    expect(container.querySelector(".device-count strong")!.textContent).toBe("1");
  });
});
