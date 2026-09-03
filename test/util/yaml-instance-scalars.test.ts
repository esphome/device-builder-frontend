import { describe, expect, it } from "vitest";
import { collectInstanceScalars } from "../../src/util/yaml-instance-scalars.js";

describe("collectInstanceScalars", () => {
  const yaml = [
    "sensor:",
    "  - platform: dht",
    "    name: Kitchen",
    ".defaultfilters:",
    "  - &tagged",
    "    name: Parked",
    "wifi:",
    "  name: NotASensor",
    "",
  ].join("\n");

  it("collects values under the requested section only", () => {
    expect(collectInstanceScalars(yaml, "name", "sensor")).toEqual(new Set(["Kitchen"]));
  });

  it("a dot-prefixed ignored key ends the section", () => {
    expect(collectInstanceScalars(yaml, "name", "sensor").has("Parked")).toBe(false);
  });

  it("collects across the whole document without a section", () => {
    expect(collectInstanceScalars(yaml, "name")).toEqual(
      new Set(["Kitchen", "Parked", "NotASensor"])
    );
  });
});
