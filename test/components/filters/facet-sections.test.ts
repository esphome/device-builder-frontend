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

import { DeviceState } from "../../../src/api/types/devices.js";
import { renderFacetSections } from "../../../src/components/filters/facet-sections.js";
import type { FacetSelection } from "../../../src/util/device-filter.js";
import { identityLocalize, renderInto } from "../../_dom.js";
import { makeConfiguredDevice } from "../../_make-configured-device.js";

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
    // Two distinct platforms (>1), one named area (>0), both update buckets.
    expect(keys(sections)).toEqual(["labels", "area", "platform", "status", "updates"]);
  });

  it("suppresses labels / status / updates in YAML mode, keeps area + platform", () => {
    const { sections } = mount({ yamlMode: true });
    expect(keys(sections)).toEqual(["area", "platform"]);
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
