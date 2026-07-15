/**
 * @vitest-environment happy-dom
 *
 * The "Hide the Device builder" toggle is offered only while the
 * remote-compute pref is on, and flipping it fires a bubbling,
 * composed `set-hide-device-builder` event carrying the next value.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/select/select.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/option/option.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { ESPHomeSettingsAppearance } from "../../../src/components/settings-dialog/appearance-section.js";

async function mount(opts: {
  remote?: boolean;
  hide?: boolean;
}): Promise<ESPHomeSettingsAppearance> {
  const el = new ESPHomeSettingsAppearance();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (el as any)._remoteComputeOnly = opts.remote ?? false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (el as any)._hideDeviceBuilder = opts.hide ?? false;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

const hideToggle = (el: ESPHomeSettingsAppearance) =>
  el.shadowRoot!.querySelector<HTMLButtonElement>(
    'button.toggle[aria-labelledby="hide-device-builder-title"]'
  );

describe("appearance hide-device-builder toggle", () => {
  it("is absent while the remote-compute pref is off", async () => {
    const el = await mount({ remote: false, hide: true });
    expect(hideToggle(el)).toBeNull();
  });

  it("shows under the remote-compute pref and fires the next value", async () => {
    const el = await mount({ remote: true, hide: false });
    const toggle = hideToggle(el)!;
    expect(toggle.getAttribute("aria-checked")).toBe("false");

    const events: boolean[] = [];
    el.addEventListener("set-hide-device-builder", (e) =>
      events.push((e as CustomEvent<boolean>).detail)
    );
    toggle.click();
    expect(events).toEqual([true]);
  });

  it("reflects the current value via aria-checked", async () => {
    const el = await mount({ remote: true, hide: true });
    expect(hideToggle(el)!.getAttribute("aria-checked")).toBe("true");
  });
});
