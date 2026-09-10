/**
 * @vitest-environment happy-dom
 *
 * The row menu offers "Show encryption key" when the key lives under
 * api: or under the esphome OTA platform, and the item emits
 * show-encryption-key.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { mount } from "../../_dom.js";
import { makeConfiguredDevice } from "../../_make-configured-device.js";
import { ESPHomeTableRowMenu } from "../../../src/components/dashboard/table-row-menu.js";

function findKeyItem(el: ESPHomeTableRowMenu): Element | undefined {
  return [...el.shadowRoot!.querySelectorAll(".menu-item")].find((item) =>
    item.textContent!.includes("dashboard.action_show_encryption_key")
  );
}

describe("table-row-menu show-encryption-key item", () => {
  it("emits show-encryption-key for an api encrypted device", async () => {
    const el = await mount(new ESPHomeTableRowMenu(), {
      device: makeConfiguredDevice({ api_enabled: true, api_encrypted: true }),
      position: { x: 10, y: 10 },
    });
    const item = findKeyItem(el);
    expect(item).toBeDefined();

    const emitted = vi.fn();
    el.addEventListener("show-encryption-key", emitted);
    (item as HTMLElement).click();
    expect(emitted).toHaveBeenCalledTimes(1);
  });

  it("offers the item when only the esphome OTA platform carries the key", async () => {
    const el = await mount(new ESPHomeTableRowMenu(), {
      device: makeConfiguredDevice({ ota_encryption_required: true }),
      position: { x: 10, y: 10 },
    });
    const item = findKeyItem(el);
    expect(item).toBeDefined();

    const emitted = vi.fn();
    el.addEventListener("show-encryption-key", emitted);
    (item as HTMLElement).click();
    expect(emitted).toHaveBeenCalledTimes(1);
  });

  it("hides the item when neither block is encrypted", async () => {
    const el = await mount(new ESPHomeTableRowMenu(), {
      device: makeConfiguredDevice({ api_enabled: true }),
      position: { x: 10, y: 10 },
    });
    expect(findKeyItem(el)).toBeUndefined();
  });
});
