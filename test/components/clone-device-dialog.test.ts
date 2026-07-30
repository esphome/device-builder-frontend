/**
 * @vitest-environment happy-dom
 *
 * Pins that the clone dialog confirms a valid new name on Enter via
 * base-dialog's confirmOnEnter, reading the shared name-inputs pair.
 */
import { describe, expect, it, vi } from "vitest";

import "../_mock-webawesome.js";

import {
  baseDialogSettled,
  deviceNameInputsOf,
  mount,
  typeFriendlyName,
} from "../_dom.js";
import { pressEnter } from "../_press-enter.js";
import { ESPHomeCloneDeviceDialog } from "../../src/components/clone-device-dialog.js";

describe("clone-device-dialog ENTER", () => {
  it("confirms a valid new name on Enter", async () => {
    const el = await mount(new ESPHomeCloneDeviceDialog());
    el.open("source");
    await el.updateComplete;
    const onConfirm = vi.fn();
    el.addEventListener("clone-confirm", onConfirm as EventListener);
    await typeFriendlyName(el, "Kitchen");
    pressEnter();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const detail = (onConfirm.mock.calls[0][0] as CustomEvent).detail;
    expect(detail.newName).toBe("kitchen");
    expect(detail.newFriendlyName).toBe("Kitchen");
  });

  it("fires clone-confirm only once on a repeated Enter", async () => {
    const el = await mount(new ESPHomeCloneDeviceDialog());
    el.open("source");
    await el.updateComplete;
    const onConfirm = vi.fn();
    el.addEventListener("clone-confirm", onConfirm as EventListener);
    await typeFriendlyName(el, "Kitchen");
    pressEnter();
    pressEnter();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("stops a same-task Enter repeat via the one-shot latch", async () => {
    // The empty/same/invalid checks are not idempotency guards (they pass
    // identically on the repeat). base-dialog detaches its Enter listener
    // in its own update after close() flips ?open — asynchronously — so an
    // Enter landing in the same task as the confirm still finds the
    // listener bound; the _resolved latch is what stops a second dispatch.
    const el = await mount(new ESPHomeCloneDeviceDialog());
    el.open("source");
    await baseDialogSettled(el);
    const onConfirm = vi.fn();
    el.addEventListener("clone-confirm", onConfirm as EventListener);
    await typeFriendlyName(el, "Kitchen");
    pressEnter(); // confirms and runs close(); the detaching update is queued
    expect((el as unknown as { _dialog: { open: boolean } })._dialog.open).toBe(false);
    pressEnter(); // same task: listener still bound; stopped only by the latch
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await baseDialogSettled(el); // base-dialog's willUpdate unbinds the listener
    pressEnter();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("a hostname-only clone uses the hostname as the friendly name", async () => {
    // Matches the create flows: the same blank-friendly action yields the
    // same display name in both.
    const el = await mount(new ESPHomeCloneDeviceDialog());
    el.open("source");
    await el.updateComplete;
    const onConfirm = vi.fn();
    el.addEventListener("clone-confirm", onConfirm as EventListener);
    const inputs = await deviceNameInputsOf(el);
    // Expand the disclosure and type only a hostname.
    inputs.shadowRoot!.querySelector<HTMLButtonElement>(".disclosure-toggle")!.click();
    await inputs.updateComplete;
    const field = inputs.shadowRoot!.querySelector<HTMLInputElement>("#device-hostname")!;
    field.value = "my_plug";
    field.dispatchEvent(new Event("input"));
    await inputs.updateComplete;
    await el.updateComplete;
    pressEnter();
    const detail = (onConfirm.mock.calls[0][0] as CustomEvent).detail;
    expect(detail.newName).toBe("my_plug");
    expect(detail.newFriendlyName).toBe("my_plug");
  });

  it("ignores Enter with an empty name", async () => {
    const el = await mount(new ESPHomeCloneDeviceDialog());
    el.open("source");
    await el.updateComplete;
    const onConfirm = vi.fn();
    el.addEventListener("clone-confirm", onConfirm as EventListener);
    pressEnter();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("ignores Enter while the derived hostname equals the source", async () => {
    const el = await mount(new ESPHomeCloneDeviceDialog());
    el.open("kitchen");
    await el.updateComplete;
    const onConfirm = vi.fn();
    el.addEventListener("clone-confirm", onConfirm as EventListener);
    await typeFriendlyName(el, "Kitchen");
    pressEnter();
    expect(onConfirm).not.toHaveBeenCalled();
    await typeFriendlyName(el, "Kitchen 2");
    pressEnter();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("marks the name inputs [autofocus] where base-dialog can find them", async () => {
    // base-dialog resolves its focus target via a light-DOM
    // querySelector("[autofocus]"), which cannot pierce the component's
    // shadow root — the host element itself must carry the attribute.
    const el = await mount(new ESPHomeCloneDeviceDialog());
    el.open("source");
    await el.updateComplete;
    const base = el.shadowRoot!.querySelector("esphome-base-dialog")!;
    const target = base.querySelector("[autofocus]");
    expect(target?.tagName.toLowerCase()).toBe("esphome-device-name-inputs");
  });

  it("open() resets the name inputs from a previous use", async () => {
    const el = await mount(new ESPHomeCloneDeviceDialog());
    el.open("source");
    await el.updateComplete;
    await typeFriendlyName(el, "Kitchen");
    el.close();
    el.open("source");
    await el.updateComplete;
    const inputs = await deviceNameInputsOf(el);
    expect(inputs.friendlyName).toBe("");
    expect(inputs.hostname).toBe("");
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
describe("clone-device-dialog base-dialog open contract", () => {
  it("open() / close() drive the reactive open flag", async () => {
    const el = await mount(new ESPHomeCloneDeviceDialog());
    const view = el as unknown as { _dialog: { open: boolean } };
    el.open("source");
    expect(view._dialog.open).toBe(true);
    el.close();
    expect(view._dialog.open).toBe(false);
  });

  it("the controller's onRequestClose flips the reactive open flag", async () => {
    const el = await mount(new ESPHomeCloneDeviceDialog());
    const view = el as unknown as {
      _dialog: { open: boolean; onRequestClose: () => void };
    };
    el.open("source");
    expect(view._dialog.open).toBe(true);
    view._dialog.onRequestClose();
    expect(view._dialog.open).toBe(false);
  });
});
