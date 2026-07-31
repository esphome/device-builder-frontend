/**
 * @vitest-environment happy-dom
 *
 * Pins the open-encryption-settings → editDeviceSection wiring on all
 * three dashboard surfaces (card grid, table, drawer), reveal opt-in
 * included.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("sonner-js", () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../../../src/util/navigation.js", () => ({ navigate: vi.fn() }));

import { renderInto } from "../../_dom.js";
import { makeConfiguredDevice } from "../../_make-configured-device.js";
import type { ConfiguredDevice } from "../../../src/api/types/devices.js";
import {
  renderCardGrid,
  renderDrawer,
  renderTable,
} from "../../../src/components/dashboard/render-content.js";
import { navigate } from "../../../src/util/navigation.js";
import { makeDashboardHost, makeTableHost } from "./_host.js";

const DEEP_LINK = "/device/kitchen.yaml?section=api&reveal=1";

afterEach(() => {
  vi.mocked(navigate).mockClear();
});

function dispatchOpen(el: Element, detail?: ConfiguredDevice) {
  el.dispatchEvent(new CustomEvent("open-encryption-settings", { detail }));
}

describe("open-encryption-settings wiring", () => {
  it("card grid deep-links to the api section with the reveal intent", () => {
    const device = makeConfiguredDevice();
    const host = makeDashboardHost({
      _devices: [device],
      _activeJobs: new Map(),
      _recentJobs: new Map(),
      _recentlyAdopted: null,
      _selectMode: false,
      _selectedDevices: new Set<string>(),
    });
    const container = renderInto(renderCardGrid(host, [device]));
    const card = container.querySelector("esphome-device-card");
    expect(card).not.toBeNull();

    dispatchOpen(card!);
    expect(navigate).toHaveBeenCalledWith(DEEP_LINK);
  });

  it("table deep-links the event's device to the api section", () => {
    const device = makeConfiguredDevice();
    const host = makeTableHost({ _devices: [device], _sortedDevices: [device] });
    const container = renderInto(renderTable(host));
    const table = container.querySelector("esphome-device-table");
    expect(table).not.toBeNull();

    dispatchOpen(table!, device);
    expect(navigate).toHaveBeenCalledWith(DEEP_LINK);
  });

  it("drawer closes and deep-links the event's device to the api section", () => {
    const device = makeConfiguredDevice();
    const host = makeDashboardHost({
      _drawerOpen: true,
      _drawerDevice: device,
      _activeJobs: new Map(),
    });
    const container = renderInto(renderDrawer(host));
    const drawer = container.querySelector("esphome-device-drawer");
    expect(drawer).not.toBeNull();

    dispatchOpen(drawer!, device);
    expect(navigate).toHaveBeenCalledWith(DEEP_LINK);
    expect(host._drawerOpen).toBe(false);
  });
});
