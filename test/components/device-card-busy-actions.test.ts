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

import type { ESPHomeDeviceCard } from "../../src/components/device-card.js";
import { mountDeviceCard as mount } from "./_device-card.js";

function accentButton(el: ESPHomeDeviceCard): HTMLButtonElement {
  const btn = el.shadowRoot!.querySelector<HTMLButtonElement>(".action-btn--accent");
  expect(btn).not.toBeNull();
  return btn!;
}

function clickEmits(el: ESPHomeDeviceCard, events: string[]): string[] {
  const fired: string[] = [];
  for (const name of events) {
    el.addEventListener(name, () => fired.push(name));
  }
  accentButton(el).click();
  return fired;
}

describe("device-card busy update/install actions", () => {
  it("busy update button is enabled and emits show-progress", async () => {
    const el = await mount({ busy: true, showUpdate: true });
    expect(accentButton(el).disabled).toBe(false);
    expect(clickEmits(el, ["show-progress", "update-device"])).toEqual(["show-progress"]);
  });

  it("idle update button emits update-device", async () => {
    const el = await mount({ busy: false, showUpdate: true });
    expect(clickEmits(el, ["show-progress", "update-device"])).toEqual(["update-device"]);
  });

  it("busy install button is enabled and emits show-progress", async () => {
    const el = await mount({ busy: true, showModified: true });
    expect(accentButton(el).disabled).toBe(false);
    expect(clickEmits(el, ["show-progress", "install-device"])).toEqual([
      "show-progress",
    ]);
  });

  it("idle install button emits install-device", async () => {
    const el = await mount({ busy: false, showModified: true });
    expect(clickEmits(el, ["show-progress", "install-device"])).toEqual([
      "install-device",
    ]);
  });
});
