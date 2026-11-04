import { describe, expect, it } from "vitest";
import { platformDomains } from "../../src/util/yaml-completion-catalog.js";
import { makeComponentEntry } from "./_make-component-entry.js";

describe("platformDomains", () => {
  it("collects the domain prefixes of dotted ids only", () => {
    const index = {
      components: [
        makeComponentEntry("sensor.dht"),
        makeComponentEntry("power_management.esp32"),
        makeComponentEntry("wifi"),
      ],
    };
    expect([...platformDomains(index)].sort()).toEqual(["power_management", "sensor"]);
  });

  it("memoizes per index", () => {
    const index = { components: [makeComponentEntry("sensor.dht")] };
    expect(platformDomains(index)).toBe(platformDomains(index));
  });
});
