/**
 * @vitest-environment happy-dom
 *
 * Pins the `open-troubleshoot` contract at the three senders: each
 * dispatches `{ configuration }` (the wire identifier, never the
 * friendly name), and the inert states stay inert.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
// Stub the drawer body; see dashboard/_device-drawer.ts.
vi.mock("../../src/components/dashboard/device-drawer-content.js", () => ({}));

import { identityLocalize, mount, renderInto } from "../_dom.js";
import { makeConfiguredDevice } from "../_make-configured-device.js";
import { DeviceState } from "../../src/api/types/devices.js";
import { ESPHomeDeviceDrawer } from "../../src/components/dashboard/device-drawer.js";
import { createDeviceColumns } from "../../src/components/dashboard/table-columns.js";
import type { ESPHomeDeviceCard } from "../../src/components/device-card.js";
import { renderStatusBadge } from "../../src/components/device-card/render-bits.js";

function makeCard(overrides: Partial<ESPHomeDeviceCard> = {}): ESPHomeDeviceCard {
  return Object.assign(document.createElement("div"), {
    busy: false,
    recentJob: null,
    activeJob: null,
    state: DeviceState.OFFLINE,
    nameAddMacSuffix: false,
    selectMode: false,
    name: "Kitchen Friendly",
    configuration: "kitchen.yaml",
    _localize: identityLocalize,
    ...overrides,
  }) as unknown as ESPHomeDeviceCard;
}

function collectDetail(target: EventTarget): { detail: unknown[] } {
  const seen: { detail: unknown[] } = { detail: [] };
  target.addEventListener("open-troubleshoot", (e) => {
    seen.detail.push((e as CustomEvent).detail);
  });
  return seen;
}

describe("open-troubleshoot senders", () => {
  it("card badge sends the configuration, not the friendly name", () => {
    const card = makeCard();
    const seen = collectDetail(card);
    const container = renderInto(renderStatusBadge(card));
    container
      .querySelector<HTMLElement>(".device-status.clickable")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(seen.detail).toEqual([{ configuration: "kitchen.yaml" }]);
  });

  it("card badge stays inert when online, untracked, or selecting", () => {
    for (const overrides of [
      { state: DeviceState.ONLINE },
      { nameAddMacSuffix: true },
      { selectMode: true },
    ]) {
      const container = renderInto(renderStatusBadge(makeCard(overrides)));
      expect(container.querySelector(".device-status.clickable")).toBeNull();
    }
  });

  it("table dot sends the configuration", () => {
    const device = makeConfiguredDevice();
    const columns = createDeviceColumns(identityLocalize);
    const statusColumn = columns.find(
      (c) => (c as { accessorKey?: string }).accessorKey === "status"
    )!;
    const cell = (statusColumn.cell as (info: unknown) => unknown)({
      getValue: () => DeviceState.OFFLINE,
      row: { original: { busy: false, recentJob: null, _device: device } },
    });
    const container = renderInto(cell);
    const seen = collectDetail(container);
    container
      .querySelector<HTMLElement>('[role="button"]')!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(seen.detail).toEqual([{ configuration: "kitchen.yaml" }]);
  });

  it("drawer button sends the configuration and hides for online/untracked", async () => {
    const el = await mount(new ESPHomeDeviceDrawer(), {
      open: true,
      device: makeConfiguredDevice({ runtime_state: { state: DeviceState.OFFLINE } }),
    });
    const seen = collectDetail(el);
    el.shadowRoot!.querySelector<HTMLButtonElement>(".troubleshoot-btn")!.click();
    expect(seen.detail).toEqual([{ configuration: "kitchen.yaml" }]);

    el.device = makeConfiguredDevice({ runtime_state: { state: DeviceState.ONLINE } });
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".troubleshoot-btn")).toBeNull();

    el.device = makeConfiguredDevice({
      name_add_mac_suffix: true,
      runtime_state: { state: DeviceState.OFFLINE },
    });
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".troubleshoot-btn")).toBeNull();
  });
});
