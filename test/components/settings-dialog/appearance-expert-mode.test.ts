/**
 * @vitest-environment happy-dom
 *
 * The Expert Mode toggle lives in Settings → Appearance (it replaced the old
 * Editor section). Flipping it must fire a bubbling, composed `set-expert-mode`
 * event carrying the *next* value so app-shell can persist it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

// Stub the wa-select/wa-option theme picker (happy-dom can't run their
// form-associated internals) and wa-icon (only chrome here).
vi.mock("@home-assistant/webawesome/dist/components/select/select.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/option/option.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { ESPHomeSettingsAppearance } from "../../../src/components/settings-dialog/appearance-section.js";

async function mount(expertMode = false): Promise<ESPHomeSettingsAppearance> {
  const el = new ESPHomeSettingsAppearance();
  // The toggle reads Expert Mode from a Lit context app-shell provides;
  // mounted bare, seed the consumed field directly.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (el as any)._expertMode = expertMode;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

const toggle = (el: ESPHomeSettingsAppearance) =>
  el.shadowRoot!.querySelector<HTMLButtonElement>('button.toggle[role="switch"]')!;

describe("appearance Expert Mode toggle", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("lists the features Expert Mode unlocks", async () => {
    const el = await mount(false);
    const features = el.shadowRoot!.querySelectorAll(".expert-feature");
    // Editor diff view, navigator search, YAML content search.
    expect(features.length).toBe(3);
    expect(el.shadowRoot!.querySelector(".expert-features-heading")).not.toBeNull();
  });

  it("reflects the current value via aria-checked", async () => {
    const off = await mount(false);
    expect(toggle(off).getAttribute("aria-checked")).toBe("false");

    const on = await mount(true);
    expect(toggle(on).getAttribute("aria-checked")).toBe("true");
  });

  it("fires set-expert-mode with the toggled value on click", async () => {
    const el = await mount(false);
    const listener = vi.fn();
    el.addEventListener("set-expert-mode", listener as EventListener);

    toggle(el).click();

    expect(listener).toHaveBeenCalledOnce();
    const event = listener.mock.calls[0][0] as CustomEvent<boolean>;
    expect(event.detail).toBe(true);
    expect(event.bubbles).toBe(true);
    expect(event.composed).toBe(true);
  });
});
