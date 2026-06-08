/**
 * @vitest-environment happy-dom
 *
 * Pins two navigator chrome behaviors: each section header carries the
 * shared per-section icon (so it matches the overview pane), and the
 * title button clears the selection to return to the device overview.
 * Dialog children are no-oped so the element constructs in happy-dom;
 * see ``device-navigator-coalesce.test.ts``.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/components/device/add-automation-dialog.js", () => ({}));
vi.mock("../../../src/components/device/add-component-dialog.js", () => ({}));
vi.mock("../../../src/components/device/add-config-dialog.js", () => ({}));
vi.mock("../../../src/components/device/add-script-dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { ESPHomeDeviceNavigator } from "../../../src/components/device/device-navigator.js";
import { SECTION_ICON } from "../../../src/components/device/section-icons.js";

async function mountNavigator(): Promise<ESPHomeDeviceNavigator> {
  const nav = new ESPHomeDeviceNavigator();
  nav.yaml = "esphome:\n  name: bktest\n";
  document.body.appendChild(nav);
  await nav.updateComplete;
  return nav;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("device-navigator section header icons", () => {
  it("renders the shared section icons in header order", async () => {
    const nav = await mountNavigator();
    const icons = [
      ...(nav.shadowRoot?.querySelectorAll(".nav-content-label wa-icon") ?? []),
    ].map((el) => el.getAttribute("name"));
    expect(icons).toEqual([
      SECTION_ICON.core,
      SECTION_ICON.components,
      SECTION_ICON.automations,
    ]);
  });
});

describe("device-navigator overview button", () => {
  it("clears the selection when the title is clicked", async () => {
    const nav = await mountNavigator();
    const events: Array<{ sectionKey: string | null }> = [];
    nav.addEventListener("section-select", (e) => events.push((e as CustomEvent).detail));
    const title = nav.shadowRoot?.querySelector<HTMLButtonElement>(".card-title-btn");
    expect(title).toBeTruthy();
    title!.click();
    expect(events).toHaveLength(1);
    expect(events[0].sectionKey).toBeNull();
  });
});
