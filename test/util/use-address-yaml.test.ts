/** Pins the use_address splice: block pick, rewrite, and input validation. */
import { describe, expect, it } from "vitest";

import {
  applyUseAddress,
  isValidUseAddress,
  networkInYaml,
  readAddressPrefill,
  removeUseAddress,
} from "../../src/util/use-address-yaml.js";

function applied(yaml: string, value: string, integrations: string[] = []): string {
  const result = applyUseAddress(yaml, value, integrations);
  if (!("yaml" in result)) throw new Error("expected a write");
  return result.yaml;
}

const WIFI_YAML = `esphome:
  name: kitchen

wifi:
  ssid: !secret wifi_ssid
  password: !secret wifi_password # keep

api:
`;

describe("applyUseAddress", () => {
  it("adds use_address while keeping secrets and comments byte-for-byte", () => {
    const updated = applied(WIFI_YAML, "10.0.0.42");
    expect(updated).toContain("  use_address: 10.0.0.42");
    expect(updated).toContain("  ssid: !secret wifi_ssid");
    expect(updated).toContain("  password: !secret wifi_password # keep");
    expect(updated).toContain("api:");
  });

  it("replaces an existing use_address", () => {
    const yaml = "wifi:\n  ssid: net\n  use_address: 10.0.0.1\n";
    const updated = applied(yaml, "10.0.0.9");
    expect(updated).toContain("use_address: 10.0.0.9");
    expect(updated).not.toContain("10.0.0.1");
  });

  it("splices a CRLF document, keeping its keys and line endings", () => {
    const updated = applied("wifi:\r\n  ssid: net\r\n", "10.0.0.9");
    expect(updated).toContain("use_address: 10.0.0.9");
    expect(updated).toContain("ssid: net");
    expect(updated).toContain("\r\n");
    expect(removeUseAddress("wifi:\r\n  use_address: 10.0.0.1\r\n")).not.toContain(
      "use_address"
    );
  });

  it("targets an ethernet block when there is no wifi", () => {
    const updated = applied("ethernet:\n  type: LAN8720\n", "10.0.0.9");
    expect(updated).toContain("  type: LAN8720");
    expect(updated).toContain("  use_address: 10.0.0.9");
  });

  it("appends a deep-merging wifi block when the config only has packages", () => {
    const updated = applied("packages:\n  base: !include common.yaml\n", "1.2.3.4", [
      "wifi",
      "api",
    ]);
    expect(updated).toContain("packages:\n  base: !include common.yaml");
    expect(updated).toContain("wifi:\n  use_address: 1.2.3.4");
  });

  it("appends an ethernet block when the compiled config says ethernet", () => {
    const updated = applied("packages:\n  base: !include common.yaml\n", "10.0.0.9", [
      "ethernet",
      "api",
    ]);
    expect(updated).toContain("ethernet:\n  use_address: 10.0.0.9");
  });

  it("quotes an IPv6 literal in an appended block", () => {
    const updated = applied("packages:\n  base: !include x.yaml\n", "fe80::1", ["wifi"]);
    expect(updated).toContain('use_address: "fe80::1"');
  });

  it("names a snippet for an include-valued header instead of duplicating it", () => {
    const yaml = "ethernet: !include net.yaml\napi:\n";
    expect(applyUseAddress(yaml, "10.0.0.9", ["wifi"])).toEqual({
      snippet: "ethernet",
    });
  });

  it("refuses a config with no network component instead of guessing wifi", () => {
    expect(
      applyUseAddress("esphome:\n  name: kitchen\napi:\n", "10.0.0.9", ["api", "logger"])
    ).toEqual({ noNetwork: true });
  });
});

describe("networkInYaml", () => {
  it("classifies present, packaged-unknown, merged-unknown, and absent", () => {
    expect(networkInYaml(WIFI_YAML)).toBe("present");
    expect(networkInYaml("wifi: !include net.yaml\n")).toBe("present");
    expect(networkInYaml("packages:\n  base: !include x.yaml\n")).toBe("unknown");
    expect(networkInYaml("<<: !include base.yaml\napi:\n")).toBe("unknown");
    expect(networkInYaml("esphome:\n  name: kitchen\napi:\n")).toBe("absent");
  });
});

describe("readAddressPrefill", () => {
  it("reads the set value, empty when unset, null when packaged", () => {
    expect(
      readAddressPrefill("wifi:\n  ssid: net\n  use_address: 10.0.0.7\n").useAddress
    ).toBe("10.0.0.7");
    expect(readAddressPrefill("wifi:\n  ssid: net\n").useAddress).toBe("");
    expect(readAddressPrefill("wifi: !include wifi.yaml\n").useAddress).toBeNull();
  });

  it("reads wifi manual_ip.static_ip and null otherwise", () => {
    expect(
      readAddressPrefill(
        "wifi:\n  ssid: net\n  manual_ip:\n    static_ip: 10.0.0.50\n    gateway: 10.0.0.1\n"
      ).staticIp
    ).toBe("10.0.0.50");
    expect(readAddressPrefill("wifi:\n  ssid: net\n").staticIp).toBeNull();
    expect(readAddressPrefill("ethernet:\n  type: LAN8720\n").staticIp).toBeNull();
    expect(
      readAddressPrefill(
        "ethernet:\n  type: LAN8720\n  manual_ip:\n    static_ip: 10.0.0.60\n"
      ).staticIp
    ).toBe("10.0.0.60");
  });
});

describe("removeUseAddress", () => {
  it("strips the key while keeping the rest of the block", () => {
    const yaml = "wifi:\n  ssid: net # keep\n  use_address: 10.0.0.1\napi:\n";
    const updated = removeUseAddress(yaml)!;
    expect(updated).not.toContain("use_address");
    expect(updated).toContain("  ssid: net # keep");
    expect(updated).toContain("api:");
  });

  it("no-ops when the key is absent and refuses an include header", () => {
    const plain = "wifi:\n  ssid: net\n";
    expect(removeUseAddress(plain)).toBe(plain);
    expect(removeUseAddress("wifi: !include wifi.yaml\n")).toBeNull();
  });
});

describe("isValidUseAddress", () => {
  it.each([
    "10.0.0.42",
    "fe80::1",
    "1:2:3:4:5:6:7:8",
    "2001:db8::42",
    "device.local",
    "host.example.com",
    "kitchen",
  ])("accepts %s", (value) => {
    expect(isValidUseAddress(value)).toBe(true);
  });

  it.each([
    "",
    " ",
    "10.0.0.299",
    // Zero-padded octets read as octal on glibc (192.168.010.1 is
    // 192.168.8.1 there) and are rejected outright elsewhere.
    "192.168.001.1",
    "192.168.010.1",
    "255.42.2.1.3",
    "1.2.3",
    "127.0.0.1",
    "localhost",
    "0.0.0.0",
    "::1",
    "0:0:0:0:0:0:0:1",
    "0:0:0:0:0:0:0:0",
    "::0:1",
    ":1:2:3",
    "1:2:3:",
    "1:2:3",
    ":::",
    "1::2::3",
    "not valid",
    "bad_host",
    "a..b",
    "-lead.example",
    "http://x",
  ])("rejects %s", (value) => {
    expect(isValidUseAddress(value)).toBe(false);
  });
});
