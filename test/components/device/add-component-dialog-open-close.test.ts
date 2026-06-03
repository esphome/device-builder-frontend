/**
 * @vitest-environment happy-dom
 *
 * Pins the add-component dialog's reactive open/close contract after the
 * migration onto esphome-base-dialog (#549): the imperative open() /
 * openWithSearch() entry points (which the three consumers call) flip the
 * reactive _open flag, request-close mirrors it back to false, and the
 * form-view back button renders in the wrapper's header-prefix slot and
 * returns to the catalog.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/dialog/dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/spinner/spinner.js", () => ({}));
vi.mock("../../../src/components/device/add-component-form.js", () => ({}));
// Stub the catalog with the two methods open()/openWithSearch() call on it.
vi.mock("../../../src/components/device/component-catalog.js", () => {
  class StubCatalog extends HTMLElement {
    load(): void {}
    filterByDomain(): void {}
  }
  if (!customElements.get("esphome-component-catalog")) {
    customElements.define("esphome-component-catalog", StubCatalog);
  }
  return {};
});

import { ESPHomeAddComponentDialog } from "../../../src/components/device/add-component-dialog.js";

async function mount(): Promise<ESPHomeAddComponentDialog> {
  const el = new ESPHomeAddComponentDialog();
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

const dialog = (el: ESPHomeAddComponentDialog): HTMLElement =>
  el.shadowRoot!.querySelector("esphome-base-dialog")!;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isOpen = (el: ESPHomeAddComponentDialog): boolean => (el as any)._open;

describe("add-component-dialog open/close contract", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("open() flips the reactive open flag and binds ?open", async () => {
    const el = await mount();
    expect(isOpen(el)).toBe(false);
    el.open();
    await el.updateComplete;
    expect(isOpen(el)).toBe(true);
    expect(dialog(el).hasAttribute("open")).toBe(true);
  });

  it("openWithSearch() also opens", async () => {
    const el = await mount();
    el.openWithSearch("output");
    await el.updateComplete;
    expect(isOpen(el)).toBe(true);
  });

  it("flips _open to false on request-close", async () => {
    const el = await mount();
    el.open();
    await el.updateComplete;
    dialog(el).dispatchEvent(new CustomEvent("request-close"));
    expect(isOpen(el)).toBe(false);
  });

  it("renders the back button in header-prefix in form view and returns to the catalog", async () => {
    const el = await mount();
    el.open();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any)._selected = { name: "GPIO Switch" };
    await el.updateComplete;
    const back = el.shadowRoot!.querySelector<HTMLButtonElement>(
      'button.back-button[slot="header-prefix"]'
    );
    expect(back).toBeTruthy();
    back!.click();
    await el.updateComplete;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any)._selected).toBeNull();
    // back in catalog view -> no back button.
    expect(
      el.shadowRoot!.querySelector('button.back-button[slot="header-prefix"]')
    ).toBeNull();
  });
});
