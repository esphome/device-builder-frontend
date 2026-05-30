/**
 * @vitest-environment happy-dom
 *
 * Behavior tests for the shared `renderAdvancedToggle` helper.
 */
import { render } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/switch/switch.js", () => ({}));

import type { LocalizeFunc } from "../../../src/common/localize.js";
import { renderAdvancedToggle } from "../../../src/components/device/advanced-toggle.js";

const localize: LocalizeFunc = (key) =>
  key === "device.show_advanced" ? "Show advanced settings" : key;

type SwitchEl = HTMLElement & { checked: boolean };

function mount(show: boolean, onChange: (show: boolean) => void): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  render(renderAdvancedToggle(show, localize, onChange), container);
  return container;
}

describe("renderAdvancedToggle", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("reflects the show state and renders the localized label", () => {
    const container = mount(true, () => {});
    const sw = container.querySelector<SwitchEl>("wa-switch");
    expect(sw).not.toBeNull();
    expect(sw!.checked).toBe(true);
    expect(container.textContent).toContain("Show advanced settings");
  });

  it("reports the new checked value through onChange on change", () => {
    const onChange = vi.fn();
    const container = mount(false, onChange);
    const sw = container.querySelector<SwitchEl>("wa-switch")!;

    sw.checked = true;
    sw.dispatchEvent(new Event("change"));
    expect(onChange).toHaveBeenLastCalledWith(true);

    sw.checked = false;
    sw.dispatchEvent(new Event("change"));
    expect(onChange).toHaveBeenLastCalledWith(false);
  });
});
