/**
 * @vitest-environment happy-dom
 *
 * The "Advanced" disclosure is driven by the parent dialog's ``advancedOpen``
 * property (so it survives navigating into an advanced option and back); the
 * toggle signals intent via a ``toggle-advanced`` event rather than flipping
 * local state.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { defaultLocalize } from "../../../src/common/localize.js";
import { ESPHomeWizardStepMethod } from "../../../src/components/wizard/wizard-step-method.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
async function mount(advancedOpen = false): Promise<ESPHomeWizardStepMethod> {
  const el = new ESPHomeWizardStepMethod();
  (el as any)._localize = defaultLocalize;
  el.advancedOpen = advancedOpen;
  document.body.appendChild(el);
  el.checkVisibility = () => true;
  await el.updateComplete;
  return el;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

afterEach(() => {
  document.body.innerHTML = "";
});

describe("wizard-step-method advanced disclosure", () => {
  it("renders advanced options only when advancedOpen is set", async () => {
    // Closed: just the primary "create new" card; the advanced disclosure
    // (a second .option-cards block) is absent and the toggle reads collapsed.
    const closed = await mount(false);
    expect(closed.shadowRoot!.querySelectorAll(".option-cards")).toHaveLength(1);
    expect(
      closed
        .shadowRoot!.querySelector(".disclosure-toggle")!
        .getAttribute("aria-expanded")
    ).toBe("false");

    // Open: the advanced block is rendered (import + empty-config cards).
    const open = await mount(true);
    expect(open.shadowRoot!.querySelectorAll(".option-cards")).toHaveLength(2);
    expect(
      open.shadowRoot!.querySelector(".disclosure-toggle")!.getAttribute("aria-expanded")
    ).toBe("true");
  });

  it("signals intent via toggle-advanced instead of flipping locally", async () => {
    const el = await mount(false);
    const onToggle = vi.fn();
    el.addEventListener("toggle-advanced", onToggle as EventListener);
    (el.shadowRoot!.querySelector(".disclosure-toggle") as HTMLButtonElement).click();
    expect(onToggle).toHaveBeenCalledTimes(1);
    // The step doesn't own the state — it just signals and stays put until the
    // parent feeds advancedOpen back down.
    expect(el.advancedOpen).toBe(false);
  });
});
