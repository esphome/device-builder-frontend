/**
 * @vitest-environment happy-dom
 *
 * Pins the partial-import result step: lists the kept files and emits
 * open-device when the user continues to the editor.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ESPHomeWizardStepImportPartial } from "../../../src/components/wizard/wizard-step-import-partial.js";

async function mount(kept: string[]): Promise<ESPHomeWizardStepImportPartial> {
  const el = new ESPHomeWizardStepImportPartial();
  el.kept = kept;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

describe("wizard-step-import-partial", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("lists every kept file", async () => {
    const el = await mount(["device.yaml", "common/wifi.yaml"]);
    const items = [...el.shadowRoot!.querySelectorAll("ul.kept li")].map(
      (li) => li.textContent
    );
    expect(items).toEqual(["device.yaml", "common/wifi.yaml"]);
  });

  it("emits open-device when the Open button is clicked", async () => {
    const el = await mount(["device.yaml"]);
    const onOpen = vi.fn();
    el.addEventListener("open-device", onOpen as EventListener);
    el.shadowRoot!.querySelector<HTMLButtonElement>(".btn--primary")!.click();
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
