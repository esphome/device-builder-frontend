/**
 * @vitest-environment happy-dom
 *
 * Pins the Update All dialog: pre-selects Online + Update available, shows the
 * live matched-device count, disables Update at zero, and bulk-installs exactly
 * the matched configurations on confirm.
 */
import { describe, expect, it, vi } from "vitest";

// The confirm path runs runBulkUpdate, which fires sonner-js toasts; mock it
// so the suite doesn't need a live toaster container.
vi.mock("sonner-js", () => ({
  default: { info: vi.fn(), error: vi.fn(), success: vi.fn() },
}));
vi.mock("../../src/components/base-dialog.js", () => ({}));
vi.mock("../../src/components/filters/filter-section.js", () => ({}));
vi.mock("../../src/components/filters/labels-filter-section.js", () => ({}));

import type { ESPHomeAPI } from "../../src/api/index.js";
import { DeviceState } from "../../src/api/types/devices.js";
import { ESPHomeUpdateAllDialog } from "../../src/components/update-all-dialog.js";
import { saveDashboardFilters } from "../../src/util/dashboard-filters-session.js";
import type { FacetSelection } from "../../src/util/device-filter.js";
import { makeConfiguredDevice } from "../_make-configured-device.js";

interface DialogInternals {
  _devices: ReturnType<typeof makeConfiguredDevice>[];
  _api: ESPHomeAPI;
  _selection: FacetSelection;
  _localize: (key: string, args?: { count?: number }) => string;
}

function fakeApi() {
  const firmwareInstallBulk = vi.fn(async () => []);
  return {
    api: { firmwareInstallBulk } as unknown as ESPHomeAPI,
    firmwareInstallBulk,
  };
}

async function mount(
  devices: ReturnType<typeof makeConfiguredDevice>[],
  api: ESPHomeAPI
) {
  const el = new ESPHomeUpdateAllDialog();
  const internals = el as unknown as DialogInternals;
  internals._devices = devices;
  internals._api = api;
  // Surface the {count} arg the production localize interpolates so the
  // summary tally is assertable (the default stub drops args).
  internals._localize = (key, args) =>
    args?.count !== undefined ? `${key}:${args.count}` : key;
  document.body.appendChild(el);
  el.open();
  await el.updateComplete;
  return el;
}

function primaryButton(el: ESPHomeUpdateAllDialog): HTMLButtonElement {
  return el.shadowRoot!.querySelector<HTMLButtonElement>(".btn--primary")!;
}

const onlineUpdatable = makeConfiguredDevice({
  configuration: "a.yaml",
  state: DeviceState.ONLINE,
  update_available: true,
});
const onlineCurrent = makeConfiguredDevice({
  configuration: "b.yaml",
  state: DeviceState.ONLINE,
  update_available: false,
});
const offlineUpdatable = makeConfiguredDevice({
  configuration: "c.yaml",
  state: DeviceState.OFFLINE,
  update_available: true,
});

describe("update-all-dialog", () => {
  it("counts only online + update-available devices by default", async () => {
    const { api } = fakeApi();
    const el = await mount([onlineUpdatable, onlineCurrent, offlineUpdatable], api);
    const summary = el.shadowRoot!.querySelector(".summary")!.textContent ?? "";
    // Only the online + update-available device (a.yaml) matches the defaults.
    expect(summary).toContain("update_all_dialog.count:1");
    expect(primaryButton(el).disabled).toBe(false);
  });

  it("ignores persisted dashboard filters (its own default selection wins)", async () => {
    // Persisting dashboard list filters must not leak into Update All, which
    // always opens on its own Online + update_available default. A saved filter
    // that would exclude the matching device (a different platform) must not
    // change what the dialog targets.
    saveDashboardFilters({
      labels: [],
      areas: [],
      platforms: ["rp2040"],
      states: [DeviceState.OFFLINE],
      updates: ["modified"],
    });
    try {
      const { api } = fakeApi();
      const el = await mount([onlineUpdatable, onlineCurrent, offlineUpdatable], api);
      const summary = el.shadowRoot!.querySelector(".summary")!.textContent ?? "";
      expect(summary).toContain("update_all_dialog.count:1");
    } finally {
      sessionStorage.clear();
    }
  });

  it("installs exactly the matched configurations on confirm", async () => {
    const { api, firmwareInstallBulk } = fakeApi();
    const el = await mount([onlineUpdatable, onlineCurrent, offlineUpdatable], api);
    primaryButton(el).click();
    expect(firmwareInstallBulk).toHaveBeenCalledWith(["a.yaml"]);
  });

  it("disables Update and skips the API call when nothing matches", async () => {
    const { api, firmwareInstallBulk } = fakeApi();
    const el = await mount([onlineCurrent, offlineUpdatable], api);
    const button = primaryButton(el);
    expect(button.disabled).toBe(true);
    button.click();
    expect(firmwareInstallBulk).not.toHaveBeenCalled();
  });

  it("recomputes the matched set when the selection changes", async () => {
    const { api, firmwareInstallBulk } = fakeApi();
    const el = await mount([onlineUpdatable, onlineCurrent, offlineUpdatable], api);
    // Default (online + update available) matches a.yaml; flip Status to
    // Offline and the live recompute should target the offline updatable one.
    (el as unknown as DialogInternals)._selection = {
      selectedLabels: [],
      selectedAreas: [],
      selectedPlatforms: [],
      selectedStates: [DeviceState.OFFLINE],
      selectedUpdateStatus: ["update_available"],
    };
    await el.updateComplete;
    primaryButton(el).click();
    expect(firmwareInstallBulk).toHaveBeenCalledWith(["c.yaml"]);
  });
});
