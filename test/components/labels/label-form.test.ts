/**
 * @vitest-environment happy-dom
 *
 * Pins _cancel() routing: the standalone create dialog and edit mode fire
 * form-cancel so the host closes (#1477); the device-drawer inline create
 * form collapses back to its toggle and stays silent.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import type { Label } from "../../../src/api/types/devices.js";
import { ESPHomeLabelForm } from "../../../src/components/labels/label-form.js";
import { mount } from "../../_dom.js";

const LABEL: Label = { id: "l1", name: "kitchen", color: "#ff0000" } as Label;

const cancelButton = (el: ESPHomeLabelForm): HTMLButtonElement =>
  el.shadowRoot!.querySelector(".create-actions .btn")!;

const toggleButton = (el: ESPHomeLabelForm): HTMLButtonElement | null =>
  el.shadowRoot!.querySelector(".create-toggle");

describe("esphome-label-form cancel", () => {
  it("fires form-cancel from the default-open create dialog", async () => {
    const el = await mount(new ESPHomeLabelForm(), { defaultOpen: true });
    const onCancel = vi.fn();
    el.addEventListener("form-cancel", onCancel);
    cancelButton(el).click();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("fires form-cancel from edit mode", async () => {
    const el = await mount(new ESPHomeLabelForm(), { editing: LABEL });
    const onCancel = vi.fn();
    el.addEventListener("form-cancel", onCancel);
    cancelButton(el).click();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("collapses the inline create form to its toggle without firing form-cancel", async () => {
    const el = await mount(new ESPHomeLabelForm());
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
