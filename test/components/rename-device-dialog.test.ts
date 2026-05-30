/**
 * @vitest-environment happy-dom
 *
 * Pins that the rename dialog confirms a valid new name on Enter (via the
 * shared EnterController), and ignores Enter when unchanged or after close.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/dialog/dialog.js", () => ({}));

import { ESPHomeRenameDeviceDialog } from "../../src/components/rename-device-dialog.js";
import { pressEnter } from "../_press-enter.js";

async function mount(): Promise<ESPHomeRenameDeviceDialog> {
  const el = new ESPHomeRenameDeviceDialog();
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

function setValue(el: ESPHomeRenameDeviceDialog, value: string): Promise<unknown> {
  const input = el.shadowRoot!.querySelector("input")!;
  input.value = value;
  input.dispatchEvent(new Event("input"));
  return el.updateComplete;
}

describe("rename-device-dialog ENTER", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("confirms a valid new name on Enter", async () => {
    const el = await mount();
    el.open("oldname");
    await el.updateComplete;
    const onConfirm = vi.fn();
    el.addEventListener("rename-confirm", onConfirm as EventListener);
    await setValue(el, "kitchen");
    pressEnter();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect((onConfirm.mock.calls[0][0] as CustomEvent).detail).toBe("kitchen");
  });

  it("ignores Enter when the name is unchanged", async () => {
    const el = await mount();
    el.open("kitchen");
    await el.updateComplete;
    const onConfirm = vi.fn();
    el.addEventListener("rename-confirm", onConfirm as EventListener);
    pressEnter();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("fires rename-confirm only once on a repeated Enter", async () => {
    // close() only starts the hide animation, so the EnterController
    // listener stays live until wa-after-hide. A held Enter must not
    // dispatch rename-confirm twice (stale second rename against the
    // already-renamed config).
    const el = await mount();
    el.open("oldname");
    await el.updateComplete;
    const onConfirm = vi.fn();
    el.addEventListener("rename-confirm", onConfirm as EventListener);
    await setValue(el, "kitchen");
    pressEnter();
    pressEnter();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("keeps Enter reachable after close() until wa-after-hide", async () => {
    // Proves the repeat window @bdraco questioned: the existing
    // unchanged/invalid checks are not idempotency guards (they pass
    // identically on the repeat), and close() only sets open=false to
    // start the ~150-250ms wa hide animation. The EnterController
    // listener detaches in _onAfterHide on wa-after-hide, NOT in
    // close() — so a second Enter still reaches _confirm during the
    // animation. The _resolved latch is the only thing stopping the
    // second dispatch here; remove it and this test sees two.
    const el = await mount();
    el.open("oldname");
    await el.updateComplete;
    const onConfirm = vi.fn();
    el.addEventListener("rename-confirm", onConfirm as EventListener);
    await setValue(el, "kitchen");
    // First Enter confirms and runs close() (open=false) but does not
    // fire wa-after-hide — i.e. mid hide-animation.
    pressEnter();
    const dialog = el.shadowRoot!.querySelector<HTMLElement & { open: boolean }>(
      "wa-dialog"
    )!;
    expect(dialog.open).toBe(false);
    // Listener still bound: the second Enter reaches _confirm and is
    // stopped only by the latch.
    pressEnter();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    // wa-after-hide finally unbinds it.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any)._onAfterHide();
    pressEnter();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("ignores Enter after the dialog hides", async () => {
    const el = await mount();
    el.open("oldname");
    await setValue(el, "kitchen");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any)._onAfterHide(); // wa-dialog close path
    const onConfirm = vi.fn();
    el.addEventListener("rename-confirm", onConfirm as EventListener);
    pressEnter();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
