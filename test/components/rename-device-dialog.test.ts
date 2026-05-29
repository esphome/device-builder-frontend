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
