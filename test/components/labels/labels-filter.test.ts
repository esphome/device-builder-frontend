/**
 * @vitest-environment happy-dom
 *
 * Pins the "Create label" sub-dialog's reactive open/close contract after the
 * migration onto esphome-base-dialog (#549): the dialog tracks _createOpen via
 * ?open, and request-close / after-hide both mirror the flag back to false so a
 * user-driven close (Escape / X / outside-click) actually dismisses and the
 * next open is clean. The popover itself is a plain <div>, not a dialog, and is
 * unaffected by the migration.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/dialog/dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("../../../src/components/labels/label-form.js", () => ({}));

import { ESPHomeLabelsFilter } from "../../../src/components/labels/labels-filter.js";

async function mount(): Promise<ESPHomeLabelsFilter> {
  const el = new ESPHomeLabelsFilter();
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

const createDialog = (el: ESPHomeLabelsFilter): HTMLElement =>
  el.shadowRoot!.querySelector("esphome-base-dialog.create-dialog")!;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isOpen = (el: ESPHomeLabelsFilter): boolean => (el as any)._createOpen;

describe("labels-filter create-dialog open/close contract", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("binds _createOpen to the wrapper's ?open", async () => {
    const el = await mount();
    expect(isOpen(el)).toBe(false);
    expect(createDialog(el).hasAttribute("open")).toBe(false);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any)._openCreateDialog();
    await el.updateComplete;
    expect(isOpen(el)).toBe(true);
    expect(createDialog(el).hasAttribute("open")).toBe(true);
  });

  it("flips _createOpen to false on request-close", async () => {
    const el = await mount();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any)._createOpen = true;
    await el.updateComplete;
    createDialog(el).dispatchEvent(new CustomEvent("request-close"));
    expect(isOpen(el)).toBe(false);
  });

  it("flips _createOpen to false on after-hide", async () => {
    const el = await mount();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any)._createOpen = true;
    await el.updateComplete;
    createDialog(el).dispatchEvent(new CustomEvent("after-hide"));
    expect(isOpen(el)).toBe(false);
  });
});
