import { describe, expect, it } from "vitest";
import { deviceBuilderChannel } from "../../src/util/device-builder-channel.js";

describe("deviceBuilderChannel", () => {
  it("returns null for a stable dotted-digit release", () => {
    expect(deviceBuilderChannel("1.0.0")).toBeNull();
    expect(deviceBuilderChannel("0.1.0")).toBeNull();
    expect(deviceBuilderChannel("2026.5.3")).toBeNull();
    expect(deviceBuilderChannel("v0.1.0")).toBeNull();
  });

  it("classifies a pre-release suffix as beta", () => {
    expect(deviceBuilderChannel("0.1.0b117")).toBe("beta");
    expect(deviceBuilderChannel("0.2.0rc1")).toBe("beta");
    expect(deviceBuilderChannel("0.1.0a1")).toBe("beta");
  });

  it("classifies 0.0.0, an empty version, or a dev marker as dev", () => {
    expect(deviceBuilderChannel("0.0.0")).toBe("dev");
    expect(deviceBuilderChannel("v0.0.0")).toBe("dev");
    expect(deviceBuilderChannel("")).toBe("dev");
    expect(deviceBuilderChannel("   ")).toBe("dev");
    expect(deviceBuilderChannel("0.1.0.dev5+g1234")).toBe("dev");
    expect(deviceBuilderChannel("2026.5.0-dev")).toBe("dev");
  });
});
