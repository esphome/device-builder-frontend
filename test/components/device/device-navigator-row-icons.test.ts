/**
 * @vitest-environment happy-dom
 *
 * Ungrouped rows (Core configuration) carry a leading domain glyph, while
 * grouped Component rows do not (the glyph lives on the subgroup header).
 * Dialog + icon children are no-oped so the element constructs in happy-dom;
 * see ``device-navigator-coalesce.test.ts``.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../src/components/device/add-automation-dialog.js", () => ({}));
vi.mock("../../../src/components/device/add-component-dialog.js", () => ({}));
vi.mock("../../../src/components/device/add-config-dialog.js", () => ({}));
vi.mock("../../../src/components/device/add-script-dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { ESPHomeDeviceNavigator } from "../../../src/components/device/device-navigator.js";

const YAML = [
  "esphome:",
  "  name: t",
  "esp32:",
  "  board: esp32dev",
  "logger:",
  "sensor:",
  "  - platform: template",
  "    id: s1",
  "  - platform: template",
  "    id: s2",
  "",
].join("\n");

async function mountNavigator(): Promise<ESPHomeDeviceNavigator> {
  const nav = new ESPHomeDeviceNavigator();
  nav.yaml = YAML;
  nav.openSections = new Set([0, 1, 2]);
  document.body.appendChild(nav);
  await nav.updateComplete;
  return nav;
}

const iconNames = (nav: ESPHomeDeviceNavigator, sel: string) =>
  [...(nav.shadowRoot?.querySelectorAll(sel) ?? [])].map((el) => el.getAttribute("name"));

describe("device-navigator row icons", () => {
  it("gives ungrouped Core rows a leading domain glyph", async () => {
    const nav = await mountNavigator();
    // esphome -> brand logo (an src, not an mdi name); esp32 -> cpu-32-bit;
    // logger -> card-text-outline.
    const icons = [...(nav.shadowRoot?.querySelectorAll(".nav-item-icon") ?? [])];
    expect(icons[0].getAttribute("src")).toContain("logo/esphome-mono-black.svg");
    expect(icons.slice(1).map((el) => el.getAttribute("name"))).toEqual([
      "cpu-32-bit",
      "card-text-outline",
    ]);
  });

  it("keeps grouped Component rows glyph-free (the subgroup header carries it)", async () => {
    const nav = await mountNavigator();
    // The sensor subgroup header shows the gauge glyph...
    expect(iconNames(nav, ".nav-subgroup-icon")).toContain("gauge");
    // ...and its rows don't repeat a per-row glyph.
    expect(iconNames(nav, ".nav-items--grouped .nav-item-icon")).toEqual([]);
  });

  it("shows each Automation row the glyph of its component domain", async () => {
    const nav = new ESPHomeDeviceNavigator();
    nav.yaml = [
      "esphome:",
      "  name: t",
      "binary_sensor:",
      "  - platform: gpio",
      "    id: b1",
      "    pin: 1",
      "    on_press:",
      "      - logger.log: pressed",
      "script:",
      "  - id: scr1",
      "    then:",
      "      - logger.log: x",
      "interval:",
      "  - interval: 60s",
      "    then:",
      "      - logger.log: tick",
      "",
    ].join("\n");
    nav.openSections = new Set([0, 1, 2]);
    document.body.appendChild(nav);
    await nav.updateComplete;

    const names = iconNames(nav, ".nav-item-icon");
    // The on_press automation targets a binary_sensor -> its component glyph.
    expect(names).toContain("checkbox-marked-circle-outline");
    expect(names).toContain("script-text-outline"); // script
    expect(names).toContain("clock-outline"); // interval
    expect(names).not.toContain("shape-outline");
  });

  it("titles each row glyph with its domain for a hover tooltip", async () => {
    const nav = new ESPHomeDeviceNavigator();
    nav.yaml = [
      "esphome:",
      "  name: t",
      "binary_sensor:",
      "  - platform: gpio",
      "    id: b1",
      "    pin: 1",
      "    on_press:",
      "      - logger.log: pressed",
      "",
    ].join("\n");
    nav.openSections = new Set([0, 1, 2]);
    document.body.appendChild(nav);
    await nav.updateComplete;

    // The on_press automation glyph carries the targeted component's domain.
    const titles = [...(nav.shadowRoot?.querySelectorAll(".nav-item-icon") ?? [])].map(
      (el) => el.getAttribute("title")
    );
    expect(titles).toContain("Binary sensor");
  });

  it("leads action-field automations with the action so they stay distinct", async () => {
    const nav = new ESPHomeDeviceNavigator();
    // The shared action-field label localizes through "{name} action"; wire a
    // localize that applies it so the rows render the production strings.
    (
      nav as unknown as { _localize: (k: string, p?: { name: string }) => string }
    )._localize = (key, params) =>
      key === "device.action_field_label" ? `${params?.name} action` : key;
    nav.yaml = [
      "esphome:",
      "  name: t",
      "switch:",
      "  - platform: template",
      "    name: mmWave Status",
      "    turn_on_action:",
      "      - logger.log: on",
      "    turn_off_action:",
      "      - logger.log: off",
      "",
    ].join("\n");
    nav.openSections = new Set([0, 1, 2]);
    document.body.appendChild(nav);
    await nav.updateComplete;

    const primaries = [
      ...(nav.shadowRoot?.querySelectorAll(".nav-item-content p") ?? []),
    ].map((el) => el.textContent?.trim());
    // The two switch.template actions lead with the action, not "mmWave Status → …".
    expect(primaries).toContain("Turn on action");
    expect(primaries).toContain("Turn off action");
  });
});
