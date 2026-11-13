/**
 * @vitest-environment happy-dom
 *
 * Pins the show-dependencies → host._showDependencies wiring on the card
 * context menu and the table.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("sonner-js", () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { renderInto } from "../../_dom.js";
import { makeConfiguredDevice } from "../../_make-configured-device.js";
import type { ConfiguredDevice } from "../../../src/api/types/devices.js";
import {
  renderCardContextMenu,
  renderTable,
} from "../../../src/components/dashboard/render-content.js";
import { makeDashboardHost, makeTableHost } from "./_host.js";

function dispatch(el: Element, detail: ConfiguredDevice) {
  el.dispatchEvent(new CustomEvent("show-dependencies", { detail }));
}

describe("show-dependencies wiring", () => {
  it("card context menu calls the host with the device", () => {
    const device = makeConfiguredDevice();
    const _showDependencies = vi.fn();
    const host = makeDashboardHost({
      _cardContextDevice: device,
      _cardContextPosition: { x: 1, y: 1 },
      _activeJobs: new Map(),
      _showDependencies,
    });
    const menu = renderInto(renderCardContextMenu(host)).querySelector(
      "esphome-table-row-menu"
    );
    expect(menu).not.toBeNull();

    dispatch(menu!, device);
    expect(_showDependencies).toHaveBeenCalledWith(device);
  });

  it("table calls the host with the event's device", () => {
    const device = makeConfiguredDevice();
    const _showDependencies = vi.fn();
    const host = makeTableHost({
      _devices: [device],
      _sortedDevices: [device],
      _showDependencies,
    });
    const table = renderInto(renderTable(host)).querySelector("esphome-device-table");
    expect(table).not.toBeNull();

    dispatch(table!, device);
    expect(_showDependencies).toHaveBeenCalledWith(device);
  });
});
