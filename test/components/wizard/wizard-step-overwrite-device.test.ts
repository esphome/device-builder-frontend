/**
 * @vitest-environment happy-dom
 *
 * Pins the upload-collision confirm step: Overwrite emits overwrite-device,
 * Cancel routes back to the method step.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ESPHomeWizardStepOverwriteDevice } from "../../../src/components/wizard/wizard-step-overwrite-device.js";

async function mount(name: string): Promise<ESPHomeWizardStepOverwriteDevice> {
  const el = new ESPHomeWizardStepOverwriteDevice();
  el.deviceName = name;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

describe("wizard-step-overwrite-device", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders a message paragraph and both actions", async () => {
    const el = await mount("kitchen.yaml");
    expect(el.shadowRoot!.querySelector("p")).not.toBeNull();
    expect(el.shadowRoot!.querySelector(".btn--primary")).not.toBeNull();
    expect(el.shadowRoot!.querySelector(".btn--cancel")).not.toBeNull();
  });

  it("emits overwrite-device when Overwrite is clicked", async () => {
    const el = await mount("kitchen.yaml");
    const onOverwrite = vi.fn();
    el.addEventListener("overwrite-device", onOverwrite as EventListener);
    el.shadowRoot!.querySelector<HTMLButtonElement>(".btn--primary")!.click();
    expect(onOverwrite).toHaveBeenCalledTimes(1);
  });

  it("routes back to the method step when Cancel is clicked", async () => {
    const el = await mount("kitchen.yaml");
    const onNext = vi.fn();
    el.addEventListener("next-step", onNext as EventListener);
    el.shadowRoot!.querySelector<HTMLButtonElement>(".btn--cancel")!.click();
    expect((onNext.mock.calls[0][0] as CustomEvent).detail).toBe("method");
  });
});
