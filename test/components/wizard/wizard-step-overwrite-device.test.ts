/**
 * @vitest-environment happy-dom
 *
 * Pins the upload-collision confirm step: Overwrite emits overwrite-device,
 * Cancel routes back to the method step.
 */
import { describe, expect, it, vi } from "vitest";
import { ESPHomeWizardStepOverwriteDevice } from "../../../src/components/wizard/wizard-step-overwrite-device.js";
import { mount } from "../../_dom.js";

describe("wizard-step-overwrite-device", () => {
  it("renders a message paragraph and both actions", async () => {
    const el = await mount(new ESPHomeWizardStepOverwriteDevice(), {
      deviceName: "kitchen.yaml",
    });
    expect(el.shadowRoot!.querySelector("p")).not.toBeNull();
    expect(el.shadowRoot!.querySelector(".btn--primary")).not.toBeNull();
    expect(el.shadowRoot!.querySelector(".btn--cancel")).not.toBeNull();
  });

  it("emits overwrite-device when Overwrite is clicked", async () => {
    const el = await mount(new ESPHomeWizardStepOverwriteDevice(), {
      deviceName: "kitchen.yaml",
    });
    const onOverwrite = vi.fn();
    el.addEventListener("overwrite-device", onOverwrite as EventListener);
    el.shadowRoot!.querySelector<HTMLButtonElement>(".btn--primary")!.click();
    expect(onOverwrite).toHaveBeenCalledTimes(1);
  });

  it("routes back to the method step when Cancel is clicked", async () => {
    const el = await mount(new ESPHomeWizardStepOverwriteDevice(), {
      deviceName: "kitchen.yaml",
    });
    const onNext = vi.fn();
    el.addEventListener("next-step", onNext as EventListener);
    el.shadowRoot!.querySelector<HTMLButtonElement>(".btn--cancel")!.click();
    expect((onNext.mock.calls[0][0] as CustomEvent).detail).toBe("method");
  });
});
