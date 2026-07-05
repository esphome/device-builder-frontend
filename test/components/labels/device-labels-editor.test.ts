/**
 * @vitest-environment happy-dom
 *
 * Pins the label editor's reactive open/close contract after the migration
 * onto esphome-base-dialog (#549): the dialog tracks _open via ?open, and
 * request-close / after-hide both mirror it back to false so a user-driven
 * close (Escape / X / outside-click) actually dismisses. Saves fire on every
 * label toggle while the dialog stays open, so it deliberately does NOT bind
 * ?busy (that would dim/lock the dialog on each toggle).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/dialog/dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
// Stub esphome-label-form with the one method the editor calls on its @query
// ref (_createForm?.collapse()); the real form pulls in heavy deps we don't need.
vi.mock("../../../src/components/labels/label-form.js", () => {
  class StubLabelForm extends HTMLElement {
    collapse(): void {}
  }
  if (!customElements.get("esphome-label-form")) {
    customElements.define("esphome-label-form", StubLabelForm);
  }
  return {};
});

import type { ConfiguredDevice } from "../../../src/api/types/devices.js";
import { ESPHomeDeviceLabelsEditor } from "../../../src/components/labels/device-labels-editor.js";

async function mount(): Promise<ESPHomeDeviceLabelsEditor> {
  const el = new ESPHomeDeviceLabelsEditor();
  el.device = { configuration: "kitchen", labels: [] } as unknown as ConfiguredDevice;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

const dialog = (el: ESPHomeDeviceLabelsEditor): HTMLElement =>
  el.shadowRoot!.querySelector("esphome-base-dialog")!;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isOpen = (el: ESPHomeDeviceLabelsEditor): boolean => (el as any)._open;

describe("device-labels-editor open/close contract", () => {
  it("opens via the Edit-labels trigger", async () => {
    const el = await mount();
    expect(isOpen(el)).toBe(false);
    el.shadowRoot!.querySelector<HTMLButtonElement>(".edit-btn")!.click();
    await el.updateComplete;
    expect(isOpen(el)).toBe(true);
    expect(dialog(el).hasAttribute("open")).toBe(true);
  });

  it("flips _open to false on request-close", async () => {
    const el = await mount();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any)._open = true;
    await el.updateComplete;
    dialog(el).dispatchEvent(new CustomEvent("request-close"));
    expect(isOpen(el)).toBe(false);
  });

  it("flips _open to false on after-hide", async () => {
    const el = await mount();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any)._open = true;
    await el.updateComplete;
    dialog(el).dispatchEvent(new CustomEvent("after-hide"));
    expect(isOpen(el)).toBe(false);
  });

  it("closes when the device prop swaps to a different device", async () => {
    const el = await mount();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any)._open = true;
    await el.updateComplete;
    el.device = { configuration: "bedroom", labels: [] } as unknown as ConfiguredDevice;
    await el.updateComplete;
    expect(isOpen(el)).toBe(false);
  });

  it("stays open on a same-device update (e.g. DEVICE_UPDATED after a toggle)", async () => {
    const el = await mount();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any)._open = true;
    await el.updateComplete;
    // Same configuration, new labels (and a new object ref, as the dashboard
    // hands down after set_labels) — the dialog must NOT close.
    el.device = {
      configuration: "kitchen",
      labels: ["a"],
    } as unknown as ConfiguredDevice;
    await el.updateComplete;
    expect(isOpen(el)).toBe(true);
  });
});
