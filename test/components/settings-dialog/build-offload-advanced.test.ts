/**
 * @vitest-environment happy-dom
 *
 * The include-local-in-pool toggle is gated on the onboarding-collected
 * experience level (Expert Mode), not a manual disclosure: advanced users see
 * it inline, everyone else doesn't render it. Flipping it fires a bubbling,
 * composed `set-offloader-include-local` event carrying the next value.
 */
import { afterEach, describe, expect, it } from "vitest";

import { ESPHomeSettingsBuildOffloadAdvanced } from "../../../src/components/settings-dialog/build-offload-advanced.js";

async function mount(
  opts: { expert?: boolean; value?: boolean | null } = {}
): Promise<ESPHomeSettingsBuildOffloadAdvanced> {
  const el = new ESPHomeSettingsBuildOffloadAdvanced();
  // Seed the consumed Lit-context fields directly (mounted bare, no provider).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (el as any)._expertMode = opts.expert ?? false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (el as any)._includeLocalInPool = opts.value ?? null;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

const toggle = (el: ESPHomeSettingsBuildOffloadAdvanced) =>
  el.shadowRoot!.querySelector<HTMLButtonElement>('button.toggle[role="switch"]');

describe("build-offload include-local toggle gating", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders nothing for non-expert users", async () => {
    const el = await mount({ expert: false, value: false });
    expect(el.shadowRoot!.querySelector(".row")).toBeNull();
    expect(toggle(el)).toBeNull();
  });

  it("renders the toggle inline (no disclosure) for expert users", async () => {
    const el = await mount({ expert: true, value: false });
    const btn = toggle(el);
    expect(btn).not.toBeNull();
    expect(btn!.getAttribute("aria-checked")).toBe("false");
    // No advanced-options disclosure button.
    expect(el.shadowRoot!.querySelector(".advanced-toggle")).toBeNull();
  });

  it("reflects the current value via aria-checked", async () => {
    const on = await mount({ expert: true, value: true });
    expect(toggle(on)!.getAttribute("aria-checked")).toBe("true");
  });

  it("shows a loading status row before the value lands", async () => {
    const el = await mount({ expert: true, value: null });
    expect(el.shadowRoot!.querySelector('[role="status"]')).not.toBeNull();
    expect(toggle(el)).toBeNull();
  });

  it("dispatches a bubbling, composed set-offloader-include-local with the next value", async () => {
    const el = await mount({ expert: true, value: false });
    let detail: unknown;
    let bubbles = false;
    let composed = false;
    el.addEventListener("set-offloader-include-local", (e) => {
      detail = (e as CustomEvent).detail;
      bubbles = e.bubbles;
      composed = e.composed;
    });

    toggle(el)!.click();

    expect(detail).toBe(true);
    expect(bubbles).toBe(true);
    expect(composed).toBe(true);
  });
});
