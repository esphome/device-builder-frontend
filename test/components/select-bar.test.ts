/**
 * @vitest-environment happy-dom
 *
 * Pins the Update split button in the bulk select bar: the main half
 * still emits update-selected, the caret opens a one-item menu whose
 * "Compile only" row emits compile-selected (mouse and keyboard), and
 * the backdrop dismisses without emitting.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import "../../src/components/select-bar.js";
import type { ESPHomeSelectBar } from "../../src/components/select-bar.js";

async function mount(selectedCount = 2): Promise<ESPHomeSelectBar> {
  const el = document.createElement("esphome-select-bar") as ESPHomeSelectBar;
  el.selectedCount = selectedCount;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

function caretOf(el: ESPHomeSelectBar): HTMLButtonElement {
  return el.shadowRoot!.querySelector<HTMLButtonElement>(".update-split__caret")!;
}

async function openMenu(el: ESPHomeSelectBar): Promise<HTMLElement> {
  caretOf(el).click();
  await el.updateComplete;
  return el.shadowRoot!.querySelector<HTMLElement>('[role="menuitem"]')!;
}

describe("esphome-select-bar update split button", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("keeps update-selected on the main half", async () => {
    const el = await mount();
    const fired = vi.fn();
    el.addEventListener("update-selected", fired);
    el.shadowRoot!.querySelector<HTMLButtonElement>(".update-split__main")!.click();
    expect(fired).toHaveBeenCalledOnce();
  });

  it("hides the menu until the caret is clicked, then exposes it via aria-expanded", async () => {
    const el = await mount();
    const caret = caretOf(el);
    expect(caret.getAttribute("aria-haspopup")).toBe("true");
    expect(caret.getAttribute("aria-expanded")).toBe("false");
    expect(el.shadowRoot!.querySelector('[role="menu"]')).toBeNull();

    caret.click();
    await el.updateComplete;
    expect(caret.getAttribute("aria-expanded")).toBe("true");
    expect(el.shadowRoot!.querySelector('[role="menu"]')).not.toBeNull();
  });

  it("emits compile-selected and closes on menu-item click", async () => {
    const el = await mount();
    const fired = vi.fn();
    el.addEventListener("compile-selected", fired);

    const item = await openMenu(el);
    item.click();
    await el.updateComplete;

    expect(fired).toHaveBeenCalledOnce();
    expect(el.shadowRoot!.querySelector('[role="menu"]')).toBeNull();
  });

  it("emits compile-selected on Enter (keyboard path)", async () => {
    const el = await mount();
    const fired = vi.fn();
    el.addEventListener("compile-selected", fired);

    const item = await openMenu(el);
    expect(item.getAttribute("tabindex")).toBe("0");
    item.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(fired).toHaveBeenCalledOnce();
  });

  it("closes on backdrop click without emitting", async () => {
    const el = await mount();
    const fired = vi.fn();
    el.addEventListener("compile-selected", fired);

    await openMenu(el);
    el.shadowRoot!.querySelector<HTMLElement>(".backdrop")!.click();
    await el.updateComplete;

    expect(fired).not.toHaveBeenCalled();
    expect(el.shadowRoot!.querySelector('[role="menu"]')).toBeNull();
  });

  it("closes on Escape without emitting", async () => {
    const el = await mount();
    const fired = vi.fn();
    el.addEventListener("compile-selected", fired);

    await openMenu(el);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await el.updateComplete;

    expect(fired).not.toHaveBeenCalled();
    expect(el.shadowRoot!.querySelector('[role="menu"]')).toBeNull();
  });

  it("disables the caret alongside the main half at zero selected", async () => {
    const el = await mount(0);
    expect(caretOf(el).disabled).toBe(true);
    expect(
      el.shadowRoot!.querySelector<HTMLButtonElement>(".update-split__main")!.disabled
    ).toBe(true);
  });

  it("closes an open menu when the selection empties", async () => {
    const el = await mount();
    await openMenu(el);

    el.selectedCount = 0;
    await el.updateComplete;

    expect(el.shadowRoot!.querySelector('[role="menu"]')).toBeNull();
    expect(caretOf(el).getAttribute("aria-expanded")).toBe("false");
  });
});
