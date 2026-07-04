/**
 * @vitest-environment happy-dom
 *
 * The expert-only "Save version history" toggle in Settings → Appearance is
 * rendered only in Expert Mode and, when clicked, fires a bubbling, composed
 * `set-version-history-enabled` event carrying the *next* value so app-shell
 * can persist it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

// Stub the wa-select/wa-option theme picker and wa-icon (happy-dom can't run
// their form-associated internals; they're only chrome here).
vi.mock("@home-assistant/webawesome/dist/components/select/select.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/option/option.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { ESPHomeSettingsAppearance } from "../../../src/components/settings-dialog/appearance-section.js";

async function mount(
  expertMode: boolean,
  versionHistoryEnabled = true
): Promise<ESPHomeSettingsAppearance> {
  const el = new ESPHomeSettingsAppearance();
  // Both flags are read from Lit contexts app-shell provides; mounted bare,
  // seed the consumed fields directly.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (el as any)._expertMode = expertMode;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (el as any)._versionHistoryEnabled = versionHistoryEnabled;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

const versionToggle = (el: ESPHomeSettingsAppearance) =>
  el.shadowRoot!.querySelector<HTMLButtonElement>(
    'button.toggle[aria-labelledby="version-history-title"]'
  );

describe("appearance version-history toggle", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("is hidden unless Expert Mode is on", async () => {
    expect(versionToggle(await mount(false))).toBeNull();
    expect(versionToggle(await mount(true))).not.toBeNull();
  });

  it("reflects the current value via aria-checked", async () => {
    expect(versionToggle(await mount(true, true))!.getAttribute("aria-checked")).toBe(
      "true"
    );
    expect(versionToggle(await mount(true, false))!.getAttribute("aria-checked")).toBe(
      "false"
    );
  });

  it("fires set-version-history-enabled with the toggled value on click", async () => {
    const el = await mount(true, true);
    const listener = vi.fn();
    el.addEventListener("set-version-history-enabled", listener as EventListener);

    versionToggle(el)!.click();

    expect(listener).toHaveBeenCalledOnce();
    const event = listener.mock.calls[0][0] as CustomEvent<boolean>;
    expect(event.detail).toBe(false);
    expect(event.bubbles).toBe(true);
    expect(event.composed).toBe(true);
  });
});
