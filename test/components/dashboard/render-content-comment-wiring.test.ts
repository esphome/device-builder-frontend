/**
 * @vitest-environment happy-dom
 *
 * Pins the card grid's ``device.comment ?? ""`` pass-through: the wire
 * type is ``string | null`` and the fixture defaults to null, so dropping
 * the coalesce would bind "null" onto every uncommented tile.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/spinner/spinner.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/tooltip/tooltip.js", () => ({}));
vi.mock("sonner-js", () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../../../src/util/navigation.js", () => ({ navigate: vi.fn() }));

import { renderInto } from "../../_dom.js";
import { makeConfiguredDevice } from "../../_make-configured-device.js";
import type { ConfiguredDevice } from "../../../src/api/types/devices.js";
import { renderCardGrid } from "../../../src/components/dashboard/render-content.js";
// Side-effect import so the grid's <esphome-device-card> actually upgrades.
import "../../../src/components/device-card.js";
import type { ESPHomeDeviceCard } from "../../../src/components/device-card.js";
import { makeDashboardHost } from "./_host.js";

async function renderCard(device: ConfiguredDevice): Promise<ESPHomeDeviceCard> {
  const host = makeDashboardHost({
    _devices: [device],
    _activeJobs: new Map(),
    _recentJobs: new Map(),
    _recentlyAdopted: null,
    _selectMode: false,
    _selectedDevices: new Set<string>(),
  });
  const container = renderInto(renderCardGrid(host, [device]));
  const card = container.querySelector<ESPHomeDeviceCard>("esphome-device-card");
  expect(card).not.toBeNull();
  await card!.updateComplete;
  return card!;
}

describe("card grid comment wiring", () => {
  it("binds the device comment onto the card", async () => {
    const card = await renderCard(makeConfiguredDevice({ comment: "Garage" }));
    expect(card.comment).toBe("Garage");
    expect(card.shadowRoot!.querySelector(".device-comment")).not.toBeNull();
  });

  it("coalesces a null comment to an empty string and renders no node", async () => {
    const card = await renderCard(makeConfiguredDevice({ comment: null }));
    expect(card.comment).toBe("");
    expect(card.shadowRoot!.querySelector(".device-comment")).toBeNull();
  });
});
