/**
 * @vitest-environment happy-dom
 *
 * Pins the Components domain grouping: a subgroup header per domain with
 * its count, subgroups start collapsed except the selected row's domain,
 * a header click toggles the rows, and other sections stay flat. Dialog +
 * search children are no-oped so the element
 * constructs in happy-dom; see ``device-navigator-coalesce.test.ts``.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../src/components/device/add-automation-dialog.js", () => ({}));
vi.mock("../../../src/components/device/add-component-dialog.js", () => ({}));
vi.mock("../../../src/components/device/add-config-dialog.js", () => ({}));
vi.mock("../../../src/components/device/add-script-dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { ESPHomeDeviceNavigator } from "../../../src/components/device/device-navigator.js";
import { clickSubgroup, sectionLine } from "./_navigator-fixtures.js";

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
  "  - platform: template",
  "    id: sw2",
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
const subExpanded = (nav: ESPHomeDeviceNavigator) =>
  [...(nav.shadowRoot?.querySelectorAll(".nav-subgroup-header") ?? [])].map((el) =>
    el.getAttribute("aria-expanded")
  );

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

describe("device-navigator domain grouping", () => {
  it("renders a subgroup header per domain with its count, rows collapsed", async () => {
    const nav = await mountNavigator([1]); // Components open
    expect(subTitles(nav)).toEqual(["Sensor", "Switch"]);
    expect(subCounts(nav)).toEqual(["2", "2"]);
    expect(subExpanded(nav)).toEqual(["false", "false"]);
    expect(navItemCount(nav)).toBe(0);
  });

  it("a header click shows the subgroup's rows, a second click hides them", async () => {
    const nav = await mountNavigator([1]);
    await clickSubgroup(nav, "Sensor");
    expect(subExpanded(nav)).toEqual(["true", "false"]);
    expect(navItemCount(nav)).toBe(2);
    await clickSubgroup(nav, "Sensor");
    expect(navItemCount(nav)).toBe(0);
    // Headers themselves stay visible.
    expect(subTitles(nav)).toEqual(["Sensor", "Switch"]);
  });

  it("opens only the selected row's domain", async () => {
    const nav = await mountNavigator([1]);
    nav.selectedKey = "switch.template";
    nav.selectedFromLine = sectionLine(YAML, "switch.template");
    await nav.updateComplete;
    expect(subExpanded(nav)).toEqual(["false", "true"]);
    expect(navItemCount(nav)).toBe(2);
    expect(nav.shadowRoot!.querySelector(".nav-item--selected")).toBeTruthy();
  });

  it("keeps the selected domain open after the selection clears", async () => {
    const nav = await mountNavigator([1]);
    nav.selectedKey = "switch.template";
    nav.selectedFromLine = sectionLine(YAML, "switch.template");
    await nav.updateComplete;
    nav.selectedKey = "";
    nav.selectedFromLine = undefined;
    await nav.updateComplete;
    expect(nav.shadowRoot!.querySelector(".nav-item--selected")).toBeNull();
    expect(subExpanded(nav)).toEqual(["false", "true"]);
  });

  it("selecting a flat config block keeps the browsed domain open", async () => {
    const nav = new ESPHomeDeviceNavigator();
    const yaml = [...YAML.split("\n").slice(0, -1), "i2c:", "  sda: GPIO1", ""].join(
      "\n"
    );
    nav.yaml = yaml;
    nav.openSections = new Set([1]);
    document.body.appendChild(nav);
    await nav.updateComplete;
    nav.selectedKey = "sensor.template";
    nav.selectedFromLine = sectionLine(yaml, "sensor.template");
    await nav.updateComplete;
    expect(subExpanded(nav)).toEqual(["true", "false"]);
    nav.selectedKey = "i2c";
    nav.selectedFromLine = sectionLine(yaml, "i2c");
    await nav.updateComplete;
    expect(
      nav.shadowRoot!.querySelector(".nav-items--single .nav-item--selected")
    ).toBeTruthy();
    expect(subExpanded(nav)).toEqual(["true", "false"]);
  });

  it("keeps an explicit toggle across a selection change", async () => {
    const nav = await mountNavigator([1]);
    // Open Switch by hand, then select a sensor row: both stay open.
    await clickSubgroup(nav, "Switch");
    nav.selectedKey = "sensor.template";
    nav.selectedFromLine = sectionLine(YAML, "sensor.template");
    await nav.updateComplete;
    expect(subExpanded(nav)).toEqual(["true", "true"]);
    // Collapse Sensor by hand; selecting its other row doesn't reopen it.
    await clickSubgroup(nav, "Sensor");
    nav.selectedFromLine = sectionLine(YAML, "sensor.template", 1);
    await nav.updateComplete;
    expect(subExpanded(nav)).toEqual(["false", "true"]);
    expect(navItemCount(nav)).toBe(2);
  });

  it("leaves non-component sections flat (no subgroups)", async () => {
    const nav = await mountNavigator([0]); // Core open
    expect(nav.shadowRoot?.querySelector(".nav-subgroup-header")).toBeNull();
  });

  it("headers a lone platform component but flattens a lone config block", async () => {
    const nav = new ESPHomeDeviceNavigator();
    nav.yaml = [
      "esphome:",
      "  name: t",
      "light:", // a lone platform component -> keeps its domain header
      "  - platform: binary",
      "    id: led",
      "    name: Status LED",
      "    output: o1",
      "i2c:", // a top-level config block -> stays a flat single row
      "  sda: GPIO1",
      "  scl: GPIO2",
      "",
    ].join("\n");
    nav.openSections = new Set([1]); // Components open
    document.body.appendChild(nav);
    await nav.updateComplete;

    // The lone Light (a "- platform:" list) gets a header with count 1; the
    // i2c config block does not.
    expect(subTitles(nav)).toEqual(["Light"]);
    expect(subCounts(nav)).toEqual(["1"]);
    // Once opened, the Light row still shows the instance name on its subtitle line.
    await clickSubgroup(nav, "Light");
    expect(
      [...nav.shadowRoot!.querySelectorAll(".nav-item-subtitle")].map((el) =>
        el.textContent?.trim()
      )
    ).toContain("Status LED");
    // i2c renders as a flat single row carrying its domain glyph.
    const single = nav.shadowRoot!.querySelector(".nav-items--single");
    expect(single).toBeTruthy();
    expect(single!.querySelector(".nav-item-icon")).toBeTruthy();
  });

  it("flattens a lone config block while filtering, keeps a lone platform header", async () => {
    const nav = new ESPHomeDeviceNavigator();
    nav.yaml = [
      "esphome:",
      "  name: t",
      "light:", // lone platform component
      "  - platform: binary",
      "    id: led",
      "    name: Status LED",
      "    output: o1",
      "i2c:", // lone config block
      "  sda: GPIO1",
      "  scl: GPIO2",
      "",
    ].join("\n");
    nav.openSections = new Set([1]); // Components open
    document.body.appendChild(nav);
    await nav.updateComplete;

    // Filtered down to the lone i2c config block: flat single row, no header,
    // same as the unfiltered view.
    await setQuery(nav, "i2c");
    expect(nav.shadowRoot!.querySelector(".nav-subgroup-header")).toBeNull();
    expect(nav.shadowRoot!.querySelector(".nav-items--single")).toBeTruthy();

    // Filtered down to the lone Light platform component: header stays.
    await setQuery(nav, "status");
    expect(subTitles(nav)).toEqual(["Light"]);
  });

  it("force-opens a collapsed domain while filtering and drops empty ones", async () => {
    const nav = await mountNavigator([1]);
    // Sensor starts collapsed; filter for a Sensor id.
    await setQuery(nav, "s1");
    // Sensor survives and shows its match despite being collapsed; Switch
    // (no match) drops out entirely.
    expect(subTitles(nav)).toEqual(["Sensor"]);
    expect(navItemCount(nav)).toBe(1);
  });
});
