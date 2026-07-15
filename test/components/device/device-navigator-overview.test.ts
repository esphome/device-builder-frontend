/**
 * @vitest-environment happy-dom
 *
 * Pins two navigator chrome behaviors: each section header carries the
 * shared per-section icon (so it matches the overview pane), and the
 * title button clears the selection to return to the device overview.
 * Dialog children are no-oped so the element constructs in happy-dom;
 * see ``device-navigator-coalesce.test.ts``.
 */
import { describe, expect, it, vi } from "vitest";

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

  it("reports whether each keyboard-operable section is expanded", async () => {
    const nav = await mountNavigator();
    const firstHeader = nav.shadowRoot!.querySelector<HTMLElement>(".nav-content")!;
    expect(firstHeader.getAttribute("role")).toBe("button");
    expect(firstHeader.getAttribute("aria-expanded")).toBe("false");

    nav.openSections = new Set([0]);
    await nav.updateComplete;

    expect(
      nav.shadowRoot!.querySelector(".nav-content")?.getAttribute("aria-expanded")
    ).toBe("true");
  });
});
