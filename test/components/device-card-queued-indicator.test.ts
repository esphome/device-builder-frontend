/**
 * @vitest-environment happy-dom
 *
 * The queued-update clock renders next to the modified/update dots; the
 * status badge keeps showing the device state (an offline device with a
 * queued update still reads "offline").
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/spinner/spinner.js", () => ({}));

import { DeviceState } from "../../src/api/types/devices.js";
import { ESPHomeDeviceCard } from "../../src/components/device-card.js";

async function mount(props: Partial<ESPHomeDeviceCard>): Promise<ESPHomeDeviceCard> {
  const el = new ESPHomeDeviceCard();
  el.name = "kitchen";
  el.configuration = "kitchen.yaml";
  Object.assign(el, props);
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

describe("device-card queued-update indicator", () => {
  it("shows the clock and keeps the offline status badge", async () => {
    const el = await mount({ queuedUpdate: true, state: DeviceState.OFFLINE });
    expect(el.shadowRoot!.querySelector(".indicator-queued")).not.toBeNull();
    const badge = el.shadowRoot!.querySelector(".device-status");
    expect(badge!.textContent).toContain("dashboard.offline");
  });

  it("renders no clock without a queued update", async () => {
    const el = await mount({ queuedUpdate: false, state: DeviceState.OFFLINE });
    expect(el.shadowRoot!.querySelector(".indicator-queued")).toBeNull();
  });
});
