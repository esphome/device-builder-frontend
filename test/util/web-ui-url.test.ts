import { describe, expect, it } from "vitest";
import type { ConfiguredDevice } from "../../src/api/types.js";
import { DeviceState } from "../../src/api/types.js";
import { buildWebUiUrl } from "../../src/util/web-ui-url.js";

function _device(overrides: Partial<ConfiguredDevice> = {}): ConfiguredDevice {
  return {
    name: "kitchen",
    friendly_name: "Kitchen",
    configuration: "kitchen.yaml",
    address: "kitchen.local",
    ip: "",
    state: DeviceState.UNKNOWN,
    platform: "esp32",
    deployed_version: "",
    current_version: "",
    comment: "",
    has_pending_changes: false,
    update_available: false,
    api_enabled: false,
    api_encrypted: false,
    loaded_integrations: [],
    web_port: null,
    ...overrides,
  } as ConfiguredDevice;
}

describe("buildWebUiUrl", () => {
  it("returns empty string when web_port is null", () => {
    expect(buildWebUiUrl(_device({ web_port: null }))).toBe("");
  });

  it("returns empty string when neither address nor ip is set", () => {
    expect(buildWebUiUrl(_device({ web_port: 80, address: "", ip: "" }))).toBe(
      "",
    );
  });

  it("uses the mDNS address when present", () => {
    expect(
      buildWebUiUrl(_device({ web_port: 80, address: "kitchen.local" })),
    ).toBe("http://kitchen.local");
  });

  it("falls back to ip when address is empty", () => {
    expect(
      buildWebUiUrl(_device({ web_port: 80, address: "", ip: "10.0.0.5" })),
    ).toBe("http://10.0.0.5");
  });

  it("omits the port when it's the default 80", () => {
    expect(
      buildWebUiUrl(_device({ web_port: 80, address: "kitchen.local" })),
    ).toBe("http://kitchen.local");
  });

  it("includes a non-default port", () => {
    expect(
      buildWebUiUrl(_device({ web_port: 8080, address: "kitchen.local" })),
    ).toBe("http://kitchen.local:8080");
  });

  it("includes ports below 80 verbatim", () => {
    expect(buildWebUiUrl(_device({ web_port: 22, address: "host" }))).toBe(
      "http://host:22",
    );
  });
});
