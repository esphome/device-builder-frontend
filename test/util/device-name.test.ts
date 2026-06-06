import { describe, expect, it } from "vitest";
import type { ConfiguredDevice } from "../../src/api/types/devices.js";
import { resolveDeviceName } from "../../src/util/device-name.js";

const devices = [
  { configuration: "kitchen.yaml", name: "kitchen" },
  { configuration: "porch.yaml", name: "porch_light" },
] as ConfiguredDevice[];

describe("resolveDeviceName", () => {
  it("resolves the node name from the configuration id", () => {
    expect(resolveDeviceName(devices, "porch.yaml")).toBe("porch_light");
  });

  it("returns empty for an unknown or blank configuration", () => {
    expect(resolveDeviceName(devices, "nope.yaml")).toBe("");
    expect(resolveDeviceName(devices, "")).toBe("");
  });
});
