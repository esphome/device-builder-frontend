/**
 * @vitest-environment happy-dom
 *
 * Pins the navigator search reveal: nothing on a short config, and a header
 * magnifier that reveals the box once the item count passes the toggle
 * threshold (the box never auto-expands). The search box is gated behind
 * Expert Mode, so the reveal tests mount with it on; a final case pins that
 * it disappears entirely with Expert Mode off. Dialog children are no-oped so
 * the element constructs in happy-dom; see ``device-navigator-coalesce.test.ts``.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../src/components/device/add-automation-dialog.js", () => ({}));
vi.mock("../../../src/components/device/add-component-dialog.js", () => ({}));
vi.mock("../../../src/components/device/add-config-dialog.js", () => ({}));
vi.mock("../../../src/components/device/add-script-dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { ESPHomeDeviceNavigator } from "../../../src/components/device/device-navigator.js";

const sensors = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    [`  - platform: template`, `    name: "S${i}"`, `    id: s${i}`].join("\n")
  );

// 3 items: under the toggle threshold (15).
const SMALL_YAML = ["esphome:", "  name: t", "wifi:", "logger:", ""].join("\n");

// ~18 items: above the toggle threshold.
const MID_YAML = ["esphome:", "  name: t", "wifi:", "sensor:", ...sensors(16), ""].join(
  "\n"
);

// 30 items: still just a magnifier, no auto-expand.
const LARGE_YAML = ["esphome:", "  name: t", "sensor:", ...sensors(30), ""].join("\n");

async function mountNavigator(
  yaml: string,
  expertMode = true
): Promise<ESPHomeDeviceNavigator> {
  const nav = new ESPHomeDeviceNavigator();
  nav.yaml = yaml;
  nav.openSections = new Set([0, 1, 2]);
  // The navigator reads Expert Mode from a Lit context normally provided
  // by app-shell; mounted bare, seed the consumed field directly.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (nav as any)._expertMode = expertMode;
  document.body.appendChild(nav);
  await nav.updateComplete;
  return nav;
}

const searchBox = (nav: ESPHomeDeviceNavigator) =>
  nav.shadowRoot!.querySelector("esphome-navigator-search")!;
const searchBtn = (nav: ESPHomeDeviceNavigator) =>
  nav.shadowRoot!.querySelector<HTMLButtonElement>(".search-btn");

describe("navigator search reveal", () => {
  it("offers neither box nor magnifier on a short config", async () => {
    const nav = await mountNavigator(SMALL_YAML);
    expect(searchBtn(nav)).toBeNull();
    expect(searchBox(nav).hasAttribute("hidden")).toBe(true);
  });

  it("hides the box behind the magnifier past the toggle threshold", async () => {
    const nav = await mountNavigator(MID_YAML);
    expect(searchBtn(nav)).not.toBeNull();
    expect(searchBox(nav).hasAttribute("hidden")).toBe(true);
  });

  it("reveals the box when the magnifier is clicked", async () => {
    const nav = await mountNavigator(MID_YAML);
    searchBtn(nav)!.click();
    await nav.updateComplete;
    expect(searchBox(nav).hasAttribute("hidden")).toBe(false);
  });

  it("toggling closed clears an active query", async () => {
    const nav = await mountNavigator(MID_YAML);
    searchBox(nav).dispatchEvent(
      new CustomEvent("navigator-search", {
        detail: { value: "s1" },
        bubbles: true,
        composed: true,
      })
    );
    await nav.updateComplete;
    expect(searchBox(nav).hasAttribute("hidden")).toBe(false);

    searchBtn(nav)!.click();
    await nav.updateComplete;
    expect(searchBox(nav).hasAttribute("hidden")).toBe(true);
    expect((searchBox(nav) as { value: string }).value).toBe("");
  });

  it("still only offers the magnifier on a large config (no auto-expand)", async () => {
    const nav = await mountNavigator(LARGE_YAML);
    expect(searchBtn(nav)).not.toBeNull();
    expect(searchBox(nav).hasAttribute("hidden")).toBe(true);
  });

  it("offers no search affordance at all with Expert Mode off", async () => {
    const nav = await mountNavigator(LARGE_YAML, false);
    expect(searchBtn(nav)).toBeNull();
    expect(searchBox(nav).hasAttribute("hidden")).toBe(true);
  });
});
