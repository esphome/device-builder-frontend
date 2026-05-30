/**
 * @vitest-environment happy-dom
 *
 * Pins that the clone dialog confirms a valid new name on Enter via the
 * shared EnterController.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/dialog/dialog.js", () => ({}));

import { ESPHomeCloneDeviceDialog } from "../../src/components/clone-device-dialog.js";
import { pressEnter } from "../_press-enter.js";

async function mount(): Promise<ESPHomeCloneDeviceDialog> {
  const el = new ESPHomeCloneDeviceDialog();
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

describe("clone-device-dialog ENTER", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("confirms a valid new name on Enter", async () => {
    const el = await mount();
    el.open("source");
    await el.updateComplete;
    const onConfirm = vi.fn();
    el.addEventListener("clone-confirm", onConfirm as EventListener);
    const input = el.shadowRoot!.querySelector<HTMLInputElement>("#clone-new-name")!;
    input.value = "kitchen";
    input.dispatchEvent(new Event("input"));
    await el.updateComplete;
    pressEnter();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect((onConfirm.mock.calls[0][0] as CustomEvent).detail.newName).toBe("kitchen");
  });

  it("fires clone-confirm only once on a repeated Enter", async () => {
    // close() only starts the hide animation, so the EnterController
    // listener stays live until wa-after-hide. A held Enter must not
    // dispatch clone-confirm twice (the second clone collides on the
    // name and surfaces a failure toast for a clone that succeeded).
    const el = await mount();
    el.open("source");
    await el.updateComplete;
    const onConfirm = vi.fn();
    el.addEventListener("clone-confirm", onConfirm as EventListener);
    const input = el.shadowRoot!.querySelector<HTMLInputElement>("#clone-new-name")!;
    input.value = "kitchen";
    input.dispatchEvent(new Event("input"));
    await el.updateComplete;
    pressEnter();
    pressEnter();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("ignores Enter with an empty name", async () => {
    const el = await mount();
    el.open("source");
    await el.updateComplete;
    const onConfirm = vi.fn();
    el.addEventListener("clone-confirm", onConfirm as EventListener);
    pressEnter();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
