/**
 * @vitest-environment happy-dom
 *
 * Pins that Enter finishes the empty-config wizard step once a name is set.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ESPHomeWizardStepEmptyConfig } from "../../../src/components/wizard/wizard-step-empty-config.js";
import { pressEnter } from "../../_press-enter.js";

async function mount(): Promise<ESPHomeWizardStepEmptyConfig> {
  const el = new ESPHomeWizardStepEmptyConfig();
  el.active = true; // the parent dialog is open
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
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

  it("re-dispatches on a second Enter (no permanent latch — parent de-dupes / allows retry)", async () => {
    const el = await mount();
    const onCreate = vi.fn();
    el.addEventListener("create-empty-config", onCreate as EventListener);
    const input = el.shadowRoot!.querySelector("input")!;
    input.value = "kitchen";
    input.dispatchEvent(new Event("input"));
    await el.updateComplete;
    pressEnter();
    pressEnter();
    // The step must not latch; create de-dupe / retry lives in the parent.
    expect(onCreate).toHaveBeenCalledTimes(2);
  });

  it("ignores Enter once the dialog is no longer active (hidden but still mounted)", async () => {
    const el = await mount();
    const input = el.shadowRoot!.querySelector("input")!;
    input.value = "kitchen";
    input.dispatchEvent(new Event("input"));
    el.active = false; // dialog hidden via light-dismiss / Escape / close
    await el.updateComplete;
    const onCreate = vi.fn();
    el.addEventListener("create-empty-config", onCreate as EventListener);
    pressEnter();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("does nothing on Enter with an empty name", async () => {
    const el = await mount();
    const onCreate = vi.fn();
    el.addEventListener("create-empty-config", onCreate as EventListener);
    pressEnter();
    expect(onCreate).not.toHaveBeenCalled();
  });
});
