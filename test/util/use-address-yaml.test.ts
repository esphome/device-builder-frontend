/** Pins the use_address splice: block pick, rewrite, and input validation. */
import { describe, expect, it } from "vitest";

import {
  applyUseAddress,
  findNetworkSection,
  isValidUseAddress,
  readStaticIp,
  readUseAddress,
  removeUseAddress,
  snippetNetworkSection,
} from "../../src/util/use-address-yaml.js";

const WIFI_YAML = `esphome:
  name: kitchen

wifi:
  ssid: !secret wifi_ssid
  password: !secret wifi_password # keep

api:
`;

describe("findNetworkSection", () => {
  it("picks the network block present in the raw text", () => {
    expect(findNetworkSection(WIFI_YAML)).toBe("wifi");
    expect(findNetworkSection("ethernet:\n  type: LAN8720\n")).toBe("ethernet");
    expect(findNetworkSection("openthread:\n")).toBe("openthread");
    expect(findNetworkSection("wifi:\r\n  ssid: net\r\n")).toBe("wifi");
    expect(
      findNetworkSection("esphome:\n  name: kit\npackages:\n  base: !include x\n")
    ).toBeNull();
  });
});

describe("applyUseAddress", () => {
  it("adds use_address while keeping secrets and comments byte-for-byte", () => {
    const updated = applyUseAddress(WIFI_YAML, "10.0.0.42")!;
    expect(updated).toContain("  use_address: 10.0.0.42");
    expect(updated).toContain("  ssid: !secret wifi_ssid");
    expect(updated).toContain("  password: !secret wifi_password # keep");
    expect(updated).toContain("api:");
  });

  it("replaces an existing use_address", () => {
    const yaml = "wifi:\n  ssid: net\n  use_address: 10.0.0.1\n";
    const updated = applyUseAddress(yaml, "10.0.0.9")!;
    expect(updated).toContain("use_address: 10.0.0.9");
    expect(updated).not.toContain("10.0.0.1");
  });

  it("targets an ethernet block when there is no wifi", () => {
    const updated = applyUseAddress("ethernet:\n  type: LAN8720\n", "10.0.0.9")!;
    expect(updated).toContain("  type: LAN8720");
    expect(updated).toContain("  use_address: 10.0.0.9");
  });

  it("returns null when the network block lives in a package", () => {
    expect(
      applyUseAddress("packages:\n  base: !include common.yaml\n", "1.2.3.4")
    ).toBeNull();
  });

  it("refuses an include-valued network header instead of corrupting it", () => {
    const yaml = "wifi: !include wifi.yaml\napi:\n";
    expect(findNetworkSection(yaml)).toBeNull();
    expect(applyUseAddress(yaml, "10.0.0.9")).toBeNull();
  });
});

describe("readUseAddress", () => {
  it("reads the set value, empty when unset, null when packaged", () => {
    expect(readUseAddress("wifi:\n  ssid: net\n  use_address: 10.0.0.7\n")).toBe(
      "10.0.0.7"
    );
    expect(readUseAddress("wifi:\n  ssid: net\n")).toBe("");
    expect(readUseAddress("wifi: !include wifi.yaml\n")).toBeNull();
  });
});

describe("readStaticIp", () => {
  it("reads wifi manual_ip.static_ip and null otherwise", () => {
    expect(
      readStaticIp(
        "wifi:\n  ssid: net\n  manual_ip:\n    static_ip: 10.0.0.50\n    gateway: 10.0.0.1\n"
      )
    ).toBe("10.0.0.50");
    expect(readStaticIp("wifi:\n  ssid: net\n")).toBeNull();
    expect(readStaticIp("ethernet:\n  type: LAN8720\n")).toBeNull();
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

describe("snippetNetworkSection", () => {
  it("names the block from the raw text, integrations, then wifi", () => {
    expect(snippetNetworkSection("ethernet: !include net.yaml\n", [])).toBe("ethernet");
    expect(snippetNetworkSection("packages:\n  a: !include x\n", ["openthread"])).toBe(
      "openthread"
    );
    expect(snippetNetworkSection("packages:\n  a: !include x\n", [])).toBe("wifi");
  });
});

describe("isValidUseAddress", () => {
  it.each([
    "10.0.0.42",
    "192.168.001.1",
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
