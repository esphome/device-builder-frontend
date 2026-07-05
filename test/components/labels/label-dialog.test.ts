/**
 * @vitest-environment happy-dom
 *
 * Pins the label dialog: ``open`` flows to the inner base-dialog,
 * ``request-close`` / ``after-hide`` re-emit at the host, the title
 * tracks create vs edit, and a catalog push dropping the edited
 * label requests close.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/dialog/dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("../../../src/components/labels/label-form.js", () => ({}));

import type { Label } from "../../../src/api/types/devices.js";
import { ESPHomeLabelDialog } from "../../../src/components/labels/label-dialog.js";

const LABEL: Label = { id: "l1", name: "kitchen", color: null } as Label;

async function mount(
  overrides: Partial<Record<string, unknown>> = {}
): Promise<ESPHomeLabelDialog> {
  const el = new ESPHomeLabelDialog();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (el as any)._catalog = [LABEL];
  Object.assign(el, overrides);
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

const inner = (el: ESPHomeLabelDialog): HTMLElement =>
  el.shadowRoot!.querySelector("esphome-base-dialog")!;

describe("esphome-label-dialog", () => {
  it("binds open to the inner dialog", async () => {
    const el = await mount();
    expect(inner(el).hasAttribute("open")).toBe(false);
    el.open = true;
    await el.updateComplete;
    expect(inner(el).hasAttribute("open")).toBe(true);
  });

  it("titles by mode: create when editing is null, edit otherwise", async () => {
    const el = await mount({ open: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((inner(el) as any).label).toBe("dashboard.labels_create");
    el.editing = LABEL;
    await el.updateComplete;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((inner(el) as any).label).toBe("dashboard.labels_edit_label");
  });

  it("forwards the edited label to the form", async () => {
    const el = await mount({ open: true, editing: LABEL });
    const form = el.shadowRoot!.querySelector("esphome-label-form");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((form as any).editing).toBe(LABEL);
  });

  it("re-emits the inner dialog's request-close and after-hide", async () => {
    const el = await mount({ open: true });
    const got: string[] = [];
    el.addEventListener("request-close", () => got.push("request-close"));
    el.addEventListener("after-hide", () => got.push("after-hide"));

    inner(el).dispatchEvent(new CustomEvent("request-close"));
    inner(el).dispatchEvent(new CustomEvent("after-hide"));
    expect(got).toEqual(["request-close", "after-hide"]);
  });

  it("requests close when the form fires form-cancel", async () => {
    const el = await mount({ open: true });
    const onClose = vi.fn();
    el.addEventListener("request-close", onClose);
    el.shadowRoot!.querySelector("esphome-label-form")!.dispatchEvent(
      new CustomEvent("form-cancel", { bubbles: true, composed: true })
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("requests close when a catalog push drops the label being edited", async () => {
    const el = await mount({ open: true, editing: LABEL });
    const onClose = vi.fn();
    el.addEventListener("request-close", onClose);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any)._catalog = [];
    await el.updateComplete;
    expect(onClose).toHaveBeenCalled();
  });

  it("leaves create mode alone when the catalog changes", async () => {
    const el = await mount({ open: true, editing: null });
    const onClose = vi.fn();
    el.addEventListener("request-close", onClose);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any)._catalog = [];
    await el.updateComplete;
    expect(onClose).not.toHaveBeenCalled();
  });
});
