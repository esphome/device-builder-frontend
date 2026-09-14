/**
 * @vitest-environment happy-dom
 *
 * Pins renderFacetSections: which sections render (gating rules), YAML-mode
 * suppression, the managed flag forwarded to labels, and the onChange patch
 * carrying the facet key the emitting section owns.
 */
import { describe, expect, it, vi } from "vitest";

// Inert section elements — we assert the props/attrs the helper binds, not
// the components' own rendering.
vi.mock("../../../src/components/filters/filter-section.js", () => ({}));
vi.mock("../../../src/components/filters/labels-filter-section.js", () => ({}));

import { identityLocalize, renderInto } from "../../_dom.js";
import { makeConfiguredDevice } from "../../_make-configured-device.js";
import { DeviceState } from "../../../src/api/types/devices.js";
import { renderFacetSections } from "../../../src/components/filters/facet-sections.js";
import type { FacetSelection } from "../../../src/util/device-filter.js";

const DEVICES = [
  makeConfiguredDevice({
    configuration: "a.yaml",
    runtime_state: { state: DeviceState.ONLINE },
    update_available: true,
    target_platform: "esp32",
    area: "Kitchen",
  }),
  makeConfiguredDevice({
    configuration: "b.yaml",
    runtime_state: { state: DeviceState.OFFLINE },
    has_pending_changes: true,
    target_platform: "esp8266",
    area: "",
  }),
];

function emptySelection(): FacetSelection {
  return {
    selectedLabels: [],
    selectedAreas: [],
    selectedPlatforms: [],
    selectedProjects: [],
    selectedNetworks: [],
    selectedStates: [],
    selectedUpdateStatus: [],
  };
}

function mount(overrides: Record<string, unknown> = {}) {
  const onChange = vi.fn();
  const container = renderInto(
    renderFacetSections({
      devices: DEVICES,
      localize: identityLocalize,
      selection: emptySelection(),
      labelUsage: {},
      yamlMode: false,
      manageLabels: true,
      onChange,
      ...overrides,
    })
  );
  const sections = [...container.querySelectorAll<HTMLElement>("[data-facet-key]")];
  return { container, sections, onChange };
}

const keys = (sections: HTMLElement[]) => sections.map((s) => s.dataset.facetKey);

describe("renderFacetSections", () => {
  it("renders labels + area + platform + status + updates when the fleet warrants", () => {
    const { sections } = mount();
    // Two distinct platforms (>1), one named area (>0), both update
    // buckets. No fixture declares a project or a network, so neither
    // of those sections surfaces.
    expect(keys(sections)).toEqual(["labels", "area", "platform", "status", "updates"]);
  });

  it("suppresses labels / status / updates in YAML mode, keeps area + platform", () => {
    const { sections } = mount({ yamlMode: true });
    expect(keys(sections)).toEqual(["area", "platform"]);
  });

  it("surfaces the project section from a single bucket up", () => {
    const devices = [
      makeConfiguredDevice({
        configuration: "p.yaml",
        runtime_state: { project_name: "apollo.plt-1" },
      }),
    ];
    expect(keys(mount({ devices }).sections)).toContain("project");
  });

  it("needs two networks before the network section is worth a pill", () => {
    const oneLink = [
      makeConfiguredDevice({
        configuration: "a.yaml",
        runtime_state: { network: "wifi" },
      }),
      makeConfiguredDevice({
        configuration: "b.yaml",
        runtime_state: { network: "wifi" },
      }),
    ];
    expect(keys(mount({ devices: oneLink }).sections)).not.toContain("network");

    const mixed = [
      makeConfiguredDevice({
        configuration: "a.yaml",
        runtime_state: { network: "wifi" },
      }),
      makeConfiguredDevice({
        configuration: "b.yaml",
        runtime_state: { network: "ethernet" },
      }),
    ];
    expect(keys(mount({ devices: mixed }).sections)).toContain("network");
  });

  it("suppresses project / network in YAML mode — both are mDNS-observed", () => {
    const devices = [
      makeConfiguredDevice({
        configuration: "a.yaml",
        runtime_state: { project_name: "apollo.plt-1", network: "wifi" },
      }),
      makeConfiguredDevice({
        configuration: "b.yaml",
        runtime_state: { project_name: "apollo.plt-1", network: "ethernet" },
      }),
    ];
    const rendered = keys(mount({ devices, yamlMode: true }).sections);
    expect(rendered).not.toContain("project");
    expect(rendered).not.toContain("network");
  });

  it("forwards manageLabels to the labels section's managed property", () => {
    const managedOn = mount({ manageLabels: true }).sections[0] as HTMLElement & {
      managed: boolean;
    };
    expect(managedOn.managed).toBe(true);
    const managedOff = mount({ manageLabels: false }).sections[0] as HTMLElement & {
      managed: boolean;
    };
    expect(managedOff.managed).toBe(false);
  });

  it("routes a section's facet-change into the matching onChange patch key", () => {
    const { sections, onChange } = mount();
    const status = sections.find((s) => s.dataset.facetKey === "status")!;
    status.dispatchEvent(
      new CustomEvent("facet-change", { detail: [DeviceState.ONLINE] })
    );
    expect(onChange).toHaveBeenCalledWith({ selectedStates: [DeviceState.ONLINE] });
  });
});
