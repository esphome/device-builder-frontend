/**
 * @vitest-environment happy-dom
 *
 * The update/install accent button stays clickable while a job runs and
 * emits `show-progress` (re-attach to the running job) instead of
 * `update-device` / `install-device`.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/spinner/spinner.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/tooltip/tooltip.js", () => ({}));

import type { ESPHomeDeviceCard } from "../../src/components/device-card.js";
import { clickCollect } from "../_dom.js";
import { mountDeviceCard as mount } from "./_device-card.js";

function accentButton(el: ESPHomeDeviceCard): HTMLButtonElement {
  const btn = el.shadowRoot!.querySelector<HTMLButtonElement>(".action-btn--accent");
  expect(btn).not.toBeNull();
  return btn!;
}

describe("device-card busy update/install actions", () => {
  it("busy update button is enabled and emits show-progress", async () => {
    const el = await mount({ busy: true, showUpdate: true });
    const btn = accentButton(el);
    expect(btn.disabled).toBe(false);
    expect(clickCollect(el, btn, ["show-progress", "update-device"])).toEqual([
      "show-progress",
    ]);
  });

  it("idle update button emits update-device", async () => {
    const el = await mount({ busy: false, showUpdate: true });
    expect(
      clickCollect(el, accentButton(el), ["show-progress", "update-device"])
    ).toEqual(["update-device"]);
  });

  it("busy install button is enabled and emits show-progress", async () => {
    const el = await mount({ busy: true, showModified: true });
    const btn = accentButton(el);
    expect(btn.disabled).toBe(false);
    expect(clickCollect(el, btn, ["show-progress", "install-device"])).toEqual([
      "show-progress",
    ]);
  });

  it("idle install button emits install-device", async () => {
    const el = await mount({ busy: false, showModified: true });
    expect(
      clickCollect(el, accentButton(el), ["show-progress", "install-device"])
    ).toEqual(["install-device"]);
  });

  it("busy card keeps Edit clickable", async () => {
    // Edit only navigates; the editor is designed for mid-job use (#1196).
    const el = await mount({ busy: true, showUpdate: true });
    const edit = el.shadowRoot!.querySelector<HTMLButtonElement>(".action-btn--primary")!;
    expect(edit.disabled).toBe(false);
    expect(clickCollect(el, edit, ["edit-device"])).toEqual(["edit-device"]);
  });
});
