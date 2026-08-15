/**
 * @vitest-environment happy-dom
 *
 * Pins the open-config-migration → editDevice({ reveal: true }) wiring on
 * all three dashboard surfaces — the reveal intent is what puts the
 * migrate nudge on screen in a YAML-only or mobile layout.
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

const DEEP_LINK = "/device/kitchen.yaml?reveal=1";

afterEach(() => {
  vi.mocked(navigate).mockClear();
});

function dispatchOpen(el: Element, detail?: ConfiguredDevice) {
  el.dispatchEvent(new CustomEvent("open-config-migration", { detail }));
}

describe("open-config-migration wiring", () => {
  it("card grid opens the editor with the reveal intent", () => {
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

  it("table opens the event's device with the reveal intent", () => {
    const device = makeConfiguredDevice();
    const host = makeTableHost({ _devices: [device], _sortedDevices: [device] });
    const container = renderInto(renderTable(host));
    const table = container.querySelector("esphome-device-table");
    expect(table).not.toBeNull();

    dispatchOpen(table!, device);
    expect(navigate).toHaveBeenCalledWith(DEEP_LINK);
  });

  it("drawer closes and opens the event's device with the reveal intent", () => {
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
