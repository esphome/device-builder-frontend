/** @vitest-environment happy-dom */
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { mount } from "../../_dom.js";
import { makeConfiguredDevice } from "../../_make-configured-device.js";
import { ESPHomeTableRowMenu } from "../../../src/components/dashboard/table-row-menu.js";
import { findMenuItem } from "./_row-menu.js";

const KEY_ITEM = "dashboard.action_show_encryption_key";

describe("table-row-menu show-encryption-key item", () => {
  it.each([
    { where: "api:", overrides: { api_encrypted: true } },
    { where: "the esphome OTA platform", overrides: { ota_encryption_required: true } },
  ])("emits show-encryption-key when $where carries the key", async ({ overrides }) => {
    const el = await mount(new ESPHomeTableRowMenu(), {
      device: makeConfiguredDevice(overrides),
      position: { x: 10, y: 10 },
    });
    const item = findMenuItem(el, KEY_ITEM);
    expect(item).toBeDefined();

    const emitted = vi.fn();
    el.addEventListener("show-encryption-key", emitted);
    (item as HTMLElement).click();
    expect(emitted).toHaveBeenCalledTimes(1);
  });

  it("hides the item when neither block is encrypted", async () => {
    const el = await mount(new ESPHomeTableRowMenu(), {
      device: makeConfiguredDevice(),
      position: { x: 10, y: 10 },
    });
    expect(findMenuItem(el, KEY_ITEM)).toBeUndefined();
  });
});
