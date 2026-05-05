import { describe, expect, it } from "vitest";
import type { ConfiguredDevice } from "../../src/api/types.js";
import { DeviceState } from "../../src/api/types.js";
import { buildWebUiUrl, safeWebUiUrl } from "../../src/util/web-ui-url.js";

const _baseDevice = {
  name: "kitchen",
  friendly_name: "Kitchen",
  configuration: "kitchen.yaml",
  comment: null,
  board_id: "esp32-c3-devkitm-1",
  target_platform: "esp32",
  address: "kitchen.local",
  ip: "",
  ip_addresses: [],
  mac_address: "",
  ethernet_mac: "",
  bluetooth_mac: "",
  web_port: null,
  current_version: "",
  deployed_version: "",
  loaded_integrations: [],
  state: DeviceState.UNKNOWN,
  expected_config_hash: "",
  deployed_config_hash: "",
  has_pending_changes: false,
  update_available: false,
  api_enabled: false,
  api_encrypted: false,
  api_encryption_active: null,
} satisfies ConfiguredDevice;

function _device(overrides: Partial<ConfiguredDevice> = {}): ConfiguredDevice {
  return { ..._baseDevice, ...overrides };
}

describe("safeWebUiUrl", () => {
  it("accepts http URLs", () => {
    expect(safeWebUiUrl("http://kitchen.local")).toBe("http://kitchen.local");
    expect(safeWebUiUrl("http://kitchen.local:8080")).toBe(
      "http://kitchen.local:8080",
    );
  });

  it("accepts https URLs", () => {
    expect(safeWebUiUrl("https://kitchen.local")).toBe("https://kitchen.local");
  });

  it("rejects javascript: URLs", () => {
    expect(safeWebUiUrl("javascript:alert(1)")).toBe("");
  });

  it("rejects data: URLs", () => {
    expect(safeWebUiUrl("data:text/html,<script>alert(1)</script>")).toBe("");
  });

  it("rejects file: URLs", () => {
    expect(safeWebUiUrl("file:///etc/passwd")).toBe("");
  });

  it("rejects malformed URLs", () => {
    expect(safeWebUiUrl("not a url")).toBe("");
    expect(safeWebUiUrl("://kitchen.local")).toBe("");
  });

  it("rejects empty string", () => {
    expect(safeWebUiUrl("")).toBe("");
  });

  it("returns the input verbatim (no canonicalization)", () => {
    // ``new URL("http://host:22").toString()`` adds a trailing
    // slash; we return the raw input so callers see the terse form.
    expect(safeWebUiUrl("http://host:22")).toBe("http://host:22");
  });
});

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

  it("brackets IPv6 hosts so the port suffix stays unambiguous", () => {
    expect(
      buildWebUiUrl(
        _device({ web_port: 80, address: "", ip: "fe80::de54:75ff:fec7:cc0" }),
      ),
    ).toBe("http://[fe80::de54:75ff:fec7:cc0]");
    expect(
      buildWebUiUrl(
        _device({
          web_port: 8080,
          address: "",
          ip: "2001:470:59ca:991:de54:75ff:fec7:cc0",
        }),
      ),
    ).toBe("http://[2001:470:59ca:991:de54:75ff:fec7:cc0]:8080");
  });

  it("leaves IPv4 and hostnames unbracketed", () => {
    expect(
      buildWebUiUrl(_device({ web_port: 8080, address: "", ip: "10.0.0.5" })),
    ).toBe("http://10.0.0.5:8080");
    expect(
      buildWebUiUrl(_device({ web_port: 8080, address: "kitchen.local" })),
    ).toBe("http://kitchen.local:8080");
  });
});
