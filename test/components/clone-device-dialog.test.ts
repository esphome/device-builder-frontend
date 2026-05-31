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

  it("keeps Enter reachable after close() until wa-after-hide", async () => {
    // The empty/same/invalid checks are not idempotency guards (they pass
    // identically on the repeat); the listener detaches in _onAfterHide, not
    // close(), so the _resolved latch is the only thing stopping a second
    // dispatch while the dialog is still hiding.
    const el = await mount();
    el.open("source");
    await el.updateComplete;
    const onConfirm = vi.fn();
    el.addEventListener("clone-confirm", onConfirm as EventListener);
    const input = el.shadowRoot!.querySelector<HTMLInputElement>("#clone-new-name")!;
    input.value = "kitchen";
    input.dispatchEvent(new Event("input"));
    await el.updateComplete;
    pressEnter(); // confirms and runs close(), but wa-after-hide hasn't fired
    const dialog = el.shadowRoot!.querySelector<HTMLElement & { open: boolean }>(
      "wa-dialog"
    )!;
    expect(dialog.open).toBe(false);
    pressEnter(); // listener still bound; stopped only by the latch
    expect(onConfirm).toHaveBeenCalledTimes(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any)._onAfterHide(); // unbinds the listener
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
