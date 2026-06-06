/**
 * @vitest-environment happy-dom
 *
 * Pins the bundle conflict resolver: per-file overwrite toggles, the
 * main-config row flag, the secrets note, and the resolve-conflicts emit.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ESPHomeWizardStepResolveConflicts } from "../../../src/components/wizard/wizard-step-resolve-conflicts.js";

async function mount(
  props: Partial<ESPHomeWizardStepResolveConflicts>
): Promise<ESPHomeWizardStepResolveConflicts> {
  const el = new ESPHomeWizardStepResolveConflicts();
  Object.assign(el, props);
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

describe("wizard-step-resolve-conflicts", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("emits the checked paths as the overwrite set", async () => {
    const el = await mount({
      conflicts: ["device.yaml", "common/wifi.yaml"],
      mainConfig: "device.yaml",
    });
    const onResolve = vi.fn();
    el.addEventListener("resolve-conflicts", onResolve as EventListener);

    // Check the first row (device.yaml), leave the include unchecked.
    el.shadowRoot!.querySelector<HTMLInputElement>("#cf-0")!.click();
    el.shadowRoot!.querySelector<HTMLButtonElement>(".btn--primary")!.click();

    expect((onResolve.mock.calls[0][0] as CustomEvent).detail.overwrite).toEqual([
      "device.yaml",
    ]);
  });

  it("toggling a row off removes it from the overwrite set", async () => {
    const el = await mount({ conflicts: ["device.yaml"], mainConfig: "device.yaml" });
    const onResolve = vi.fn();
    el.addEventListener("resolve-conflicts", onResolve as EventListener);
    const box = el.shadowRoot!.querySelector<HTMLInputElement>("#cf-0")!;
    box.click(); // on
    box.click(); // off
    el.shadowRoot!.querySelector<HTMLButtonElement>(".btn--primary")!.click();
    expect((onResolve.mock.calls[0][0] as CustomEvent).detail.overwrite).toEqual([]);
  });

  it("flags the main-config row and shows the secrets note when present", async () => {
    const el = await mount({
      conflicts: ["device.yaml"],
      mainConfig: "device.yaml",
      hasSecrets: true,
    });
    expect(el.shadowRoot!.querySelector(".badge")).not.toBeNull();
    expect(el.shadowRoot!.querySelector(".secrets-note")).not.toBeNull();
  });

  it("omits the badge and secrets note when not applicable", async () => {
    const el = await mount({
      conflicts: ["common/wifi.yaml"],
      mainConfig: "device.yaml",
      hasSecrets: false,
    });
    expect(el.shadowRoot!.querySelector(".badge")).toBeNull();
    expect(el.shadowRoot!.querySelector(".secrets-note")).toBeNull();
  });

  it("cancel routes back to the method step", async () => {
    const el = await mount({ conflicts: ["device.yaml"] });
    const onNext = vi.fn();
    el.addEventListener("next-step", onNext as EventListener);
    el.shadowRoot!.querySelector<HTMLButtonElement>(".btn--cancel")!.click();
    expect((onNext.mock.calls[0][0] as CustomEvent).detail).toBe("method");
  });
});
