/**
 * @vitest-environment happy-dom
 *
 * Pins that Enter finishes the empty-config wizard step once a name is set.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ESPHomeWizardStepEmptyConfig } from "../../../src/components/wizard/wizard-step-empty-config.js";

async function mount(): Promise<ESPHomeWizardStepEmptyConfig> {
  const el = new ESPHomeWizardStepEmptyConfig();
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

function pressEnter(): void {
  window.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
      composed: true,
    })
  );
}

describe("wizard-step-empty-config ENTER", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("emits create-empty-config on Enter once a name is set", async () => {
    const el = await mount();
    const onCreate = vi.fn();
    el.addEventListener("create-empty-config", onCreate as EventListener);
    const input = el.shadowRoot!.querySelector("input")!;
    input.value = "kitchen";
    input.dispatchEvent(new Event("input"));
    await el.updateComplete;
    pressEnter();
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect((onCreate.mock.calls[0][0] as CustomEvent).detail.name).toBe("kitchen");
  });

  it("does nothing on Enter with an empty name", async () => {
    const el = await mount();
    const onCreate = vi.fn();
    el.addEventListener("create-empty-config", onCreate as EventListener);
    pressEnter();
    expect(onCreate).not.toHaveBeenCalled();
  });
});
