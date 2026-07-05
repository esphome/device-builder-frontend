/**
 * @vitest-environment happy-dom
 *
 * Pins the navigator search/filter behavior: a query keeps only matching
 * rows, drops sections with no match, force-opens the ones that remain,
 * and shows an empty state when nothing matches. Dialog children are
 * no-oped so the element constructs in happy-dom; see
 * ``device-navigator-coalesce.test.ts``.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../src/components/device/add-automation-dialog.js", () => ({}));
vi.mock("../../../src/components/device/add-component-dialog.js", () => ({}));
vi.mock("../../../src/components/device/add-config-dialog.js", () => ({}));
vi.mock("../../../src/components/device/add-script-dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { ESPHomeDeviceNavigator } from "../../../src/components/device/device-navigator.js";
import { navItemMatches } from "../../../src/components/device/navigator-search-match.js";

const YAML = [
  "esphome:",
  "  name: t",
  "wifi:",
  "sensor:",
  "  - platform: template",
  '    name: "Living Temp"',
  "    id: living_temp",
  "switch:",
  "  - platform: template",
  '    name: "Relay One"',
  "    id: relay_one",
  "",
].join("\n");

async function mountNavigator(query = ""): Promise<ESPHomeDeviceNavigator> {
  const nav = new ESPHomeDeviceNavigator();
  nav.yaml = YAML;
  // All sections open so the unfiltered baseline renders their rows.
  nav.openSections = new Set([0, 1, 2]);
  document.body.appendChild(nav);
  await nav.updateComplete;
  if (query) {
    // Drive filtering through the public ``navigator-search`` contract
    // rather than the private query state.
    const search = nav.shadowRoot!.querySelector("esphome-navigator-search")!;
    search.dispatchEvent(
      new CustomEvent("navigator-search", {
        detail: { value: query },
        bubbles: true,
        composed: true,
      })
    );
    await nav.updateComplete;
  }
  return nav;
}

const sectionHeaders = (nav: ESPHomeDeviceNavigator) =>
  nav.shadowRoot?.querySelectorAll(".nav-content") ?? [];
const rowSubtitles = (nav: ESPHomeDeviceNavigator) =>
  [...(nav.shadowRoot?.querySelectorAll(".nav-item-subtitle") ?? [])].map((el) =>
    el.textContent?.trim()
  );

describe("navItemMatches", () => {
  it("matches any term case-insensitively", () => {
    expect(navItemMatches("binary", "GPIO Binary Sensor", "button_1")).toBe(true);
  });

  it("matches a later term (e.g. the id) even when earlier terms don't", () => {
    expect(
      navItemMatches("living_temp", "Template Sensor", "Living Temp", "living_temp")
    ).toBe(true);
  });

  it("returns false when no term contains the query", () => {
    expect(navItemMatches("zzzzz", "Template Sensor", "Living Temp")).toBe(false);
  });

  it("treats an empty query as a match", () => {
    expect(navItemMatches("", "anything", undefined)).toBe(true);
  });
});

describe("device-navigator search filtering", () => {
  it("keeps only matching rows and hides non-matching sections", async () => {
    const nav = await mountNavigator("living");
    // Only the Components section survives; Core and Automations drop out.
    expect(sectionHeaders(nav)).toHaveLength(1);
    expect(rowSubtitles(nav)).toEqual(["Living Temp"]);
  });

  it("matches on the id even when the displayed name differs", async () => {
    // "Living Temp" (name) has a space; only the id "living_temp" matches.
    const nav = await mountNavigator("living_temp");
    expect(rowSubtitles(nav)).toEqual(["Living Temp"]);
  });

  it("shows the empty state when nothing matches", async () => {
    const nav = await mountNavigator("zzzzz");
    expect(sectionHeaders(nav)).toHaveLength(0);
    expect(nav.shadowRoot?.querySelector(".nav-empty")).toBeTruthy();
  });

  it("renders every section when the query is empty", async () => {
    const nav = await mountNavigator();
    expect(sectionHeaders(nav).length).toBeGreaterThan(1);
    expect(nav.shadowRoot?.querySelector(".nav-empty")).toBeNull();
  });
});
