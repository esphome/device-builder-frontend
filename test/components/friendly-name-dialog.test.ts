/**
 * @vitest-environment happy-dom
 *
 * Pins that the friendly-name dialog confirms a changed value on Enter via
 * the shared EnterController, and goes inert once closed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/components/base-dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/checkbox/checkbox.js", () => ({}));

import { ESPHomeFriendlyNameDialog } from "../../src/components/friendly-name-dialog.js";
import { pressEnter } from "../_press-enter.js";

async function mount(): Promise<ESPHomeFriendlyNameDialog> {
  const el = new ESPHomeFriendlyNameDialog();
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

function setValue(el: ESPHomeFriendlyNameDialog, value: string): Promise<unknown> {
  const input = el.shadowRoot!.querySelector<HTMLInputElement>("#friendly-name-input")!;
  input.value = value;
  input.dispatchEvent(new Event("input"));
  return el.updateComplete;
}

describe("friendly-name-dialog ENTER", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("confirms a changed friendly name on Enter", async () => {
    const el = await mount();
    el.open("kitchen", "Kitchen");
    await el.updateComplete;
    const onConfirm = vi.fn();
    el.addEventListener("friendly-name-confirm", onConfirm as EventListener);
    await setValue(el, "Living Room");
    pressEnter();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect((onConfirm.mock.calls[0][0] as CustomEvent).detail.newFriendlyName).toBe(
      "Living Room"
    );
  });

  it("fires friendly-name-confirm once on a held (auto-repeat) Enter", async () => {
    // Models OS auto-repeat as separate tasks with a microtask drain
    // between (keydown -> updateComplete -> keydown). The listener
    // detaches in willUpdate on the first keydown's close(), so the
    // second finds it gone — no latch needed.
    const el = await mount();
    el.open("kitchen", "Kitchen");
    await el.updateComplete;
    const onConfirm = vi.fn();
    el.addEventListener("friendly-name-confirm", onConfirm as EventListener);
    await setValue(el, "Living Room");
    pressEnter({ repeat: true }); // confirms + runs close(), schedules the detaching update
    await el.updateComplete; // the inter-keystroke turn: willUpdate unbinds the listener
    pressEnter({ repeat: true }); // listener already gone — no second dispatch
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("ignores Enter once closed (inactive)", async () => {
    const el = await mount();
    el.open("kitchen", "Kitchen");
    await setValue(el, "Living Room");
    el.close();
    await el.updateComplete;
    const onConfirm = vi.fn();
    el.addEventListener("friendly-name-confirm", onConfirm as EventListener);
    pressEnter();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
