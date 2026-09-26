/**
 * Pins the project / network facets and their filter predicates.
 *
 * Both dimensions are mDNS-observed and backend-persisted, so the
 * pins that matter are: a device with no value is dropped rather than
 * pooled into an "unknown" bucket, and an offline device still counts
 * (the whole point of persisting the TXT values is that a project
 * filter doesn't silently lose the fleet that happens to be asleep).
 */
import { describe, expect, it } from "vitest";

import { makeConfiguredDevice } from "../_make-configured-device.js";
import { DeviceState } from "../../src/api/types/devices.js";
import {
  activeFacetCount,
  applyFacetFilters,
  type FacetSelection,
} from "../../src/util/device-filter.js";
import { computeNetworkFacet, computeProjectFacet } from "../../src/util/facets.js";

const device = makeConfiguredDevice;

const emptySelection: FacetSelection = {
  selectedLabels: [],
  selectedAreas: [],
  selectedPlatforms: [],
  selectedProjects: [],
  selectedNetworks: [],
  selectedStates: [],
  selectedUpdateStatus: [],
};

const FLEET = [
  device({
    configuration: "a.yaml",
    runtime_state: { project_name: "apollo.plt-1", network: "wifi" },
  }),
  device({
    configuration: "b.yaml",
    runtime_state: { project_name: "apollo.plt-1", network: "ethernet" },
  }),
  device({
    configuration: "c.yaml",
    runtime_state: { project_name: "dcoulson.rrn00", network: "wifi" },
  }),
  // Hand-written YAML: no project, and mDNS hasn't named a link.
  device({ configuration: "d.yaml" }),
];

describe("computeProjectFacet", () => {
  it("tallies one bucket per project, most-populated first", () => {
    expect(computeProjectFacet(FLEET)).toEqual([
      { id: "apollo.plt-1", name: "apollo.plt-1", count: 2 },
      { id: "dcoulson.rrn00", name: "dcoulson.rrn00", count: 1 },
    ]);
  });

  it("drops projectless devices instead of pooling them into a bucket", () => {
    const ids = computeProjectFacet(FLEET).map((o) => o.id);
    expect(ids).not.toContain("");
  });

  it("counts an offline device — the value is persisted, not live-only", () => {
    const options = computeProjectFacet([
      device({
        configuration: "asleep.yaml",
        runtime_state: { state: DeviceState.OFFLINE, project_name: "apollo.plt-1" },
      }),
    ]);
    expect(options).toEqual([{ id: "apollo.plt-1", name: "apollo.plt-1", count: 1 }]);
  });

  it("returns an empty array for a fleet with no projects", () => {
    expect(computeProjectFacet([device({ configuration: "x.yaml" })])).toEqual([]);
  });
});

describe("computeNetworkFacet", () => {
  it("tallies the raw wire values", () => {
    expect(computeNetworkFacet(FLEET)).toEqual([
      { id: "wifi", name: "wifi", count: 2 },
      { id: "ethernet", name: "ethernet", count: 1 },
    ]);
  });

  it("drops devices whose firmware never announced a link", () => {
    expect(computeNetworkFacet([device({ configuration: "x.yaml" })])).toEqual([]);
  });
});

describe("applyFacetFilters — project / network", () => {
  it("narrows to the selected project", () => {
    const out = applyFacetFilters(FLEET, {
      ...emptySelection,
      selectedProjects: ["apollo.plt-1"],
    });
    expect(out.map((d) => d.configuration)).toEqual(["a.yaml", "b.yaml"]);
  });

  it("ORs within the project facet", () => {
    const out = applyFacetFilters(FLEET, {
      ...emptySelection,
      selectedProjects: ["apollo.plt-1", "dcoulson.rrn00"],
    });
    expect(out).toHaveLength(3);
  });

  it("narrows to the selected network", () => {
    const out = applyFacetFilters(FLEET, {
      ...emptySelection,
      selectedNetworks: ["ethernet"],
    });
    expect(out.map((d) => d.configuration)).toEqual(["b.yaml"]);
  });

  it("ANDs project against network", () => {
    const out = applyFacetFilters(FLEET, {
      ...emptySelection,
      selectedProjects: ["apollo.plt-1"],
      selectedNetworks: ["wifi"],
    });
    expect(out.map((d) => d.configuration)).toEqual(["a.yaml"]);
  });

  it("never matches a projectless device on a project selection", () => {
    const out = applyFacetFilters(FLEET, {
      ...emptySelection,
      selectedProjects: [""],
    });
    expect(out).toEqual([]);
  });

  it("leaves the fleet alone when neither facet is selected", () => {
    expect(applyFacetFilters(FLEET, emptySelection)).toHaveLength(4);
  });
});

describe("activeFacetCount", () => {
  it("counts project and network selections toward the Filters badge", () => {
    expect(
      activeFacetCount({
        ...emptySelection,
        selectedProjects: ["apollo.plt-1"],
        selectedNetworks: ["wifi", "ethernet"],
      })
    ).toBe(3);
  });
});
