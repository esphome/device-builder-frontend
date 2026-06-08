/**
 * @vitest-environment happy-dom
 *
 * Pins the Components domain grouping: a subgroup header per domain with
 * its count, collapsing a subgroup hides its rows, and other sections
 * stay flat. Dialog + search children are no-oped so the element
 * constructs in happy-dom; see ``device-navigator-coalesce.test.ts``.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/components/device/add-automation-dialog.js", () => ({}));
vi.mock("../../../src/components/device/add-component-dialog.js", () => ({}));
vi.mock("../../../src/components/device/add-config-dialog.js", () => ({}));
vi.mock("../../../src/components/device/add-script-dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { ESPHomeDeviceNavigator } from "../../../src/components/device/device-navigator.js";

const YAML = [
  "esphome:",
  "  name: t",
  "sensor:",
  "  - platform: template",
  "    id: s1",
  "  - platform: template",
  "    id: s2",
  "switch:",
  "  - platform: template",
  "    id: sw1",
  "",
].join("\n");

async function mountNavigator(open: number[]): Promise<ESPHomeDeviceNavigator> {
  const nav = new ESPHomeDeviceNavigator();
  nav.yaml = YAML;
  nav.openSections = new Set(open);
  document.body.appendChild(nav);
  await nav.updateComplete;
  return nav;
}

const subTitles = (nav: ESPHomeDeviceNavigator) =>
  [...(nav.shadowRoot?.querySelectorAll(".nav-subgroup-title") ?? [])].map((el) =>
    el.textContent?.trim()
  );
const subCounts = (nav: ESPHomeDeviceNavigator) =>
  [...(nav.shadowRoot?.querySelectorAll(".nav-subgroup-count") ?? [])].map((el) =>
    el.textContent?.trim()
  );
const navItemCount = (nav: ESPHomeDeviceNavigator) =>
  nav.shadowRoot?.querySelectorAll(".nav-item").length ?? 0;

async function setQuery(nav: ESPHomeDeviceNavigator, value: string): Promise<void> {
  const search = nav.shadowRoot!.querySelector("esphome-navigator-search")!;
  search.dispatchEvent(
    new CustomEvent("navigator-search", {
      detail: { value },
      bubbles: true,
      composed: true,
    })
  );
  await nav.updateComplete;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("device-navigator domain grouping", () => {
  it("renders a subgroup header per domain with its count", async () => {
    const nav = await mountNavigator([1]); // Components open
    expect(subTitles(nav)).toEqual(["Sensor", "Switch"]);
    expect(subCounts(nav)).toEqual(["2", "1"]);
    expect(navItemCount(nav)).toBe(3);
  });

  it("collapsing a subgroup hides its rows", async () => {
    const nav = await mountNavigator([1]);
    const sensorHeader =
      nav.shadowRoot?.querySelector<HTMLElement>(".nav-subgroup-header");
    sensorHeader!.click();
    await nav.updateComplete;
    // The two Sensor rows are hidden; only the Switch row remains.
    expect(navItemCount(nav)).toBe(1);
    // Headers themselves stay visible.
    expect(subTitles(nav)).toEqual(["Sensor", "Switch"]);
  });

  it("leaves non-component sections flat (no subgroups)", async () => {
    const nav = await mountNavigator([0]); // Core open
    expect(nav.shadowRoot?.querySelector(".nav-subgroup-header")).toBeNull();
  });

  it("force-opens a collapsed domain while filtering and drops empty ones", async () => {
    const nav = await mountNavigator([1]);
    // Collapse Sensor, then filter for a Sensor id.
    nav.shadowRoot!.querySelector<HTMLElement>(".nav-subgroup-header")!.click();
    await nav.updateComplete;
    await setQuery(nav, "s1");
    // Sensor survives and shows its match despite being collapsed; Switch
    // (no match) drops out entirely.
    expect(subTitles(nav)).toEqual(["Sensor"]);
    expect(navItemCount(nav)).toBe(1);
  });
});
