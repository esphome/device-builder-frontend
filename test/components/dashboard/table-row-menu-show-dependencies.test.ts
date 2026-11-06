/** @vitest-environment happy-dom */
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { findMenuItem, mount } from "../../_dom.js";
import { makeConfiguredDevice } from "../../_make-configured-device.js";
import { ESPHomeTableRowMenu } from "../../../src/components/dashboard/table-row-menu.js";

describe("table-row-menu show-dependencies item", () => {
  it("emits show-dependencies with the device", async () => {
    const device = makeConfiguredDevice();
    const el = await mount(new ESPHomeTableRowMenu(), {
      device,
      position: { x: 10, y: 10 },
    });
    const item = findMenuItem(el, "dashboard.action_show_dependencies");
    expect(item).toBeDefined();

    const emitted = vi.fn();
    el.addEventListener("show-dependencies", emitted);
    (item as HTMLElement).click();
    expect(emitted).toHaveBeenCalledTimes(1);
    expect((emitted.mock.calls[0][0] as CustomEvent).detail).toBe(device);
  });
});
