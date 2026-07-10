/**
 * @vitest-environment happy-dom
 *
 * Pins the YAML-search hit header: the title link navigates by
 * configuration filename (not the friendly label), so opening the editor
 * from a search hit loads the device instead of an empty editor.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import type { YamlSearchHit } from "../../../src/api/types/devices.js";
import { renderYamlMode } from "../../../src/components/dashboard/render-yaml.js";
import type { ESPHomePageDashboard } from "../../../src/pages/dashboard.js";
import { renderInto } from "../../_dom.js";
import { makeDashboardHost } from "./_host.js";

function makeHit(): YamlSearchHit {
  return {
    configuration: "living_room.yaml",
    device_name: "living_room",
    friendly_name: "Living Room",
    matches: [
      {
        line_number: 3,
        line_text: "  name: living_room",
        before: ["esphome:"],
        after: ["  platform: ESP32"],
      },
    ],
  };
}

function makeHost(hits: YamlSearchHit[]): ESPHomePageDashboard {
  return makeDashboardHost({ _search: "living", _yamlSearch: { hits } });
}

describe("renderYamlMode hit header", () => {
  it("links the title to the configuration filename, not the friendly label", () => {
    const container = renderInto(renderYamlMode(makeHost([makeHit()])));
    const anchor = container.querySelector<HTMLAnchorElement>(".yaml-hit-group-name");
    expect(anchor?.getAttribute("href")).toBe("/device/living_room.yaml");
  });

  it("displays the friendly label as the title text", () => {
    const container = renderInto(renderYamlMode(makeHost([makeHit()])));
    const anchor = container.querySelector<HTMLAnchorElement>(".yaml-hit-group-name");
    expect(anchor?.textContent?.trim()).toBe("Living Room");
  });
});
