/**
 * @vitest-environment happy-dom
 *
 * Pins _cancel() routing: the standalone create dialog and edit mode fire
 * form-cancel so the host closes (#1477); the device-drawer inline create
 * form collapses back to its toggle and stays silent.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import type { Label } from "../../../src/api/types/devices.js";
import { ESPHomeLabelForm } from "../../../src/components/labels/label-form.js";

const LABEL: Label = { id: "l1", name: "kitchen", color: "#ff0000" } as Label;

async function mount(
  overrides: Partial<Record<string, unknown>> = {}
): Promise<ESPHomeLabelForm> {
  const el = new ESPHomeLabelForm();
  Object.assign(el, overrides);
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

const cancelButton = (el: ESPHomeLabelForm): HTMLButtonElement =>
  el.shadowRoot!.querySelector(".create-actions .btn")!;

const toggleButton = (el: ESPHomeLabelForm): HTMLButtonElement | null =>
  el.shadowRoot!.querySelector(".create-toggle");

describe("esphome-label-form cancel", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("fires form-cancel from the default-open create dialog", async () => {
    const el = await mount({ defaultOpen: true });
    const onCancel = vi.fn();
    el.addEventListener("form-cancel", onCancel);
    cancelButton(el).click();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("fires form-cancel from edit mode", async () => {
    const el = await mount({ editing: LABEL });
    const onCancel = vi.fn();
    el.addEventListener("form-cancel", onCancel);
    cancelButton(el).click();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("collapses the inline create form to its toggle without firing form-cancel", async () => {
    const el = await mount();
    el.expand();
    await el.updateComplete;
    const onCancel = vi.fn();
    el.addEventListener("form-cancel", onCancel);
    cancelButton(el).click();
    await el.updateComplete;
    expect(onCancel).not.toHaveBeenCalled();
    expect(toggleButton(el)).not.toBeNull();
  });
});
