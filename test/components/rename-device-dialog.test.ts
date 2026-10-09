/**
 * @vitest-environment happy-dom
 *
 * Pins that the rename dialog confirms a changed hostname and/or friendly
 * name on Enter (via base-dialog's confirmOnEnter), reports which fields
 * changed, and ignores Enter when unchanged, invalid or after close.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/dialog/dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/checkbox/checkbox.js", () => ({}));

import { baseDialogSettled, mount } from "../_dom.js";
import { pressEnter } from "../_press-enter.js";
import {
  ESPHomeRenameDeviceDialog,
  type RenameConfirmDetail,
} from "../../src/components/rename-device-dialog.js";

function setInput(
  el: ESPHomeRenameDeviceDialog,
  id: string,
  value: string
): Promise<unknown> {
  const input = el.shadowRoot!.querySelector<HTMLInputElement>(`#${id}`)!;
  input.value = value;
  input.dispatchEvent(new Event("input"));
  return el.updateComplete;
}

const setName = (el: ESPHomeRenameDeviceDialog, value: string) =>
  setInput(el, "rename-device-name", value);
const setFriendly = (el: ESPHomeRenameDeviceDialog, value: string) =>
  setInput(el, "friendly-name-input", value);

function submitButton(el: ESPHomeRenameDeviceDialog): HTMLButtonElement {
  return el.shadowRoot!.querySelector<HTMLButtonElement>(".btn--primary")!;
}

async function openWithListener(): Promise<{
  el: ESPHomeRenameDeviceDialog;
  onConfirm: ReturnType<typeof vi.fn>;
}> {
  const el = await mount(new ESPHomeRenameDeviceDialog());
  el.open("oldname", "Old Name");
  await baseDialogSettled(el);
  const onConfirm = vi.fn();
  el.addEventListener("rename-confirm", onConfirm as EventListener);
  return { el, onConfirm };
}

function detailOf(onConfirm: ReturnType<typeof vi.fn>): RenameConfirmDetail {
  return (onConfirm.mock.calls[0][0] as CustomEvent<RenameConfirmDetail>).detail;
}

describe("rename-device-dialog ENTER", () => {
  it("confirms a valid new hostname on Enter, reporting the friendly name unchanged", async () => {
    const { el, onConfirm } = await openWithListener();
    await setName(el, "kitchen");
    pressEnter();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(detailOf(onConfirm)).toEqual({
      newName: "kitchen",
      newFriendlyName: undefined,
      install: true,
    });
  });

  it("confirms a friendly-name-only change with the hostname reported unchanged", async () => {
    const { el, onConfirm } = await openWithListener();
    await setFriendly(el, "Kitchen Light");
    pressEnter();
    expect(detailOf(onConfirm)).toEqual({
      newName: undefined,
      newFriendlyName: "Kitchen Light",
      install: true,
    });
  });

  it("confirms both fields in one event", async () => {
    const { el, onConfirm } = await openWithListener();
    await setFriendly(el, "Kitchen Light");
    await setName(el, "kitchen");
    pressEnter();
    expect(detailOf(onConfirm)).toEqual({
      newName: "kitchen",
      newFriendlyName: "Kitchen Light",
      install: true,
    });
  });

  it("forwards an unticked install box", async () => {
    const { el, onConfirm } = await openWithListener();
    const box = el.shadowRoot!.querySelector(
      "wa-checkbox"
    ) as unknown as HTMLInputElement;
    box.checked = false;
    box.dispatchEvent(new Event("change"));
    await el.updateComplete;
    await setName(el, "kitchen");
    pressEnter();
    expect(detailOf(onConfirm).install).toBe(false);
  });

  it("ignores Enter when nothing changed", async () => {
    const { onConfirm } = await openWithListener();
    pressEnter();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("ignores Enter and disables submit when the friendly name is emptied", async () => {
    const { el, onConfirm } = await openWithListener();
    await setFriendly(el, "   ");
    pressEnter();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(submitButton(el).disabled).toBe(true);
  });

  it("ignores Enter when the hostname is invalid", async () => {
    const { el, onConfirm } = await openWithListener();
    await setName(el, "Not Valid!");
    pressEnter();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(submitButton(el).disabled).toBe(true);
  });

  it("fires rename-confirm only once on a repeated Enter", async () => {
    const { el, onConfirm } = await openWithListener();
    await setName(el, "kitchen");
    pressEnter();
    pressEnter();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("stops a same-task Enter repeat via the one-shot latch", async () => {
    // The unchanged/invalid checks are not idempotency guards (they pass
    // identically on the repeat). base-dialog detaches its Enter listener
    // in its own update after close() flips ?open — asynchronously — so an
    // Enter landing in the same task as the confirm still finds the
    // listener bound; the _resolved latch is what stops a second dispatch.
    const { el, onConfirm } = await openWithListener();
    await setName(el, "kitchen");
    pressEnter(); // confirms and runs close(); the detaching update is queued
    expect((el as unknown as { _dialog: { open: boolean } })._dialog.open).toBe(false);
    pressEnter(); // same task: listener still bound; stopped only by the latch
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await baseDialogSettled(el); // base-dialog's willUpdate unbinds the listener
    pressEnter();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("ignores Enter after close() settles", async () => {
    const el = await mount(new ESPHomeRenameDeviceDialog());
    el.open("oldname", "Old Name");
    await baseDialogSettled(el);
    await setName(el, "kitchen");
    el.close();
    await baseDialogSettled(el); // detaches the Enter listener
    const onConfirm = vi.fn();
    el.addEventListener("rename-confirm", onConfirm as EventListener);
    pressEnter();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("re-seeds both fields and the install box on reopen", async () => {
    const el = await mount(new ESPHomeRenameDeviceDialog());
    el.open("oldname", "Old Name");
    await baseDialogSettled(el);
    await setName(el, "kitchen");
    await setFriendly(el, "Kitchen");
    el.close();
    await baseDialogSettled(el);
    el.open("other", "Other");
    await baseDialogSettled(el);
    const name = el.shadowRoot!.querySelector<HTMLInputElement>("#rename-device-name")!;
    const friendly =
      el.shadowRoot!.querySelector<HTMLInputElement>("#friendly-name-input")!;
    expect(name.value).toBe("other");
    expect(friendly.value).toBe("Other");
    expect(submitButton(el).disabled).toBe(true);
  });
});

/**
 * Regression coverage for the esphome-base-dialog migration (#549).
 *
 * The migration swapped the imperative ``dialog.open`` for a reactive
 * open flag (now owned by DialogOpenController), so the open/close
 * contract is the part most likely to silently regress.
 * esphome-base-dialog never mutates its own ``open`` on a user close, so
 * the host's controller must flip the flag in ``onRequestClose``
 * (Escape / X / backdrop) — otherwise a re-render would re-assert ``?open``
 * and the dialog could never dismiss.
 */
describe("rename-device-dialog base-dialog open contract", () => {
  it("open() / close() drive the reactive open flag", async () => {
    const el = await mount(new ESPHomeRenameDeviceDialog());
    const view = el as unknown as { _dialog: { open: boolean } };
    el.open("oldname", "Old Name");
    expect(view._dialog.open).toBe(true);
    el.close();
    expect(view._dialog.open).toBe(false);
  });

  it("the controller's onRequestClose flips the reactive open flag", async () => {
    const el = await mount(new ESPHomeRenameDeviceDialog());
    const view = el as unknown as {
      _dialog: { open: boolean; onRequestClose: () => void };
    };
    el.open("oldname", "Old Name");
    expect(view._dialog.open).toBe(true);
    view._dialog.onRequestClose();
    expect(view._dialog.open).toBe(false);
  });
});
