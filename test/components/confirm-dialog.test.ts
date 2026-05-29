/**
 * @vitest-environment happy-dom
 *
 * Pins that Enter confirms a non-destructive confirm-dialog, never a destructive one.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/dialog/dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { ESPHomeConfirmDialog } from "../../src/components/confirm-dialog.js";

async function mount(): Promise<ESPHomeConfirmDialog> {
  const el = new ESPHomeConfirmDialog();
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

function pressEnter(): void {
  window.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
      composed: true,
    })
  );
}

describe("confirm-dialog ENTER", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("confirms a non-destructive dialog on Enter", async () => {
    const el = await mount();
    const onConfirm = vi.fn();
    el.addEventListener("confirm", onConfirm);
    el.open();
    pressEnter();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("does not confirm a destructive dialog on Enter", async () => {
    const el = await mount();
    el.destructive = true;
    await el.updateComplete;
    const onConfirm = vi.fn();
    el.addEventListener("confirm", onConfirm);
    el.open();
    pressEnter();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("does not confirm before the dialog is opened", async () => {
    const el = await mount();
    const onConfirm = vi.fn();
    el.addEventListener("confirm", onConfirm);
    pressEnter();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
