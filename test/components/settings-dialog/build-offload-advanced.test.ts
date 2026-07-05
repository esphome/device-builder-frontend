/**
 * @vitest-environment happy-dom
 *
 * The include-local-in-pool toggle renders inline for every user (no
 * disclosure, no expert gate — it's buried enough that gating would hide it
 * from everyone who'd use it). Flipping it fires a bubbling, composed
 * `set-offloader-include-local` event carrying the next value.
 */
import { describe, expect, it } from "vitest";

import { ESPHomeSettingsBuildOffloadAdvanced } from "../../../src/components/settings-dialog/build-offload-advanced.js";

async function mount(
  value: boolean | null = null
): Promise<ESPHomeSettingsBuildOffloadAdvanced> {
  const el = new ESPHomeSettingsBuildOffloadAdvanced();
  // Seed the consumed Lit-context field directly (mounted bare, no provider).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (el as any)._includeLocalInPool = value;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

const toggle = (el: ESPHomeSettingsBuildOffloadAdvanced) =>
  el.shadowRoot!.querySelector<HTMLButtonElement>('button.toggle[role="switch"]');

describe("build-offload include-local toggle", () => {
  it("renders the toggle inline, with no advanced-options disclosure", async () => {
    const el = await mount(false);
    const btn = toggle(el);
    expect(btn).not.toBeNull();
    expect(btn!.getAttribute("aria-checked")).toBe("false");
    expect(el.shadowRoot!.querySelector(".advanced-toggle")).toBeNull();
  });

  it("reflects the current value via aria-checked", async () => {
    const on = await mount(true);
    expect(toggle(on)!.getAttribute("aria-checked")).toBe("true");
  });

  it("shows a loading status row before the value lands", async () => {
    const el = await mount(null);
    expect(el.shadowRoot!.querySelector('[role="status"]')).not.toBeNull();
    expect(toggle(el)).toBeNull();
  });

  it("dispatches a bubbling, composed set-offloader-include-local with the next value", async () => {
    const el = await mount(false);
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
