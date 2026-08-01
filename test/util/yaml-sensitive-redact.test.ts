import { describe, expect, it } from "vitest";
import { maskSensitiveYaml } from "../../src/util/yaml-sensitive-redact.js";

describe("maskSensitiveYaml", () => {
  it("masks inline credentials and leaves everything else intact", () => {
    const yaml = [
      "esphome:",
      "  name: garage",
      "wifi:",
      "  ssid: mynetwork",
      "  password: hunter2",
      "  ap:",
      "    ssid: Garage Fallback",
      "    ap_password: fallback-pass",
      "ota:",
      "  - platform: esphome",
      "    password: ota-pass",
    ].join("\n");
    const masked = maskSensitiveYaml(yaml);
    expect(masked).not.toContain("hunter2");
    expect(masked).not.toContain("fallback-pass");
    expect(masked).not.toContain("ota-pass");
    expect(masked).toContain("  password: •");
    expect(masked).toContain("    ap_password: •");
    expect(masked).toContain("  ssid: mynetwork");
    expect(masked).toContain("  name: garage");
    expect(masked.split("\n")).toHaveLength(yaml.split("\n").length);
  });

  it("masks the parent-scoped api encryption key", () => {
    const yaml = "api:\n  encryption:\n    key: c2VjcmV0a2V5bWF0ZXJpYWw=";
    const masked = maskSensitiveYaml(yaml);
    expect(masked).not.toContain("c2VjcmV0");
    expect(masked).toContain("    key: •");
  });

  it("masks block-scalar credentials line by line, keeping the header", () => {
    const yaml = "mqtt:\n  password: |\n    line-one\n    line-two\nsensor:";
    const masked = maskSensitiveYaml(yaml);
    expect(masked).not.toContain("line-one");
    expect(masked).not.toContain("line-two");
    expect(masked).toContain("  password: |");
    expect(masked).toContain("sensor:");
  });

  it("preserves !secret and ${substitution} indirections", () => {
    const yaml = [
      "wifi:",
      "  password: !secret wifi_password",
      "ota:",
      "  password: ${ota_pass}",
    ].join("\n");
    expect(maskSensitiveYaml(yaml)).toBe(yaml);
  });

  it("masks commented-out credentials", () => {
    const masked = maskSensitiveYaml("wifi:\n  # password: hunter2");
    expect(masked).not.toContain("hunter2");
    expect(masked).toContain("  # password: •");
  });

  it("masks a trailing comment beside a masked value", () => {
    const masked = maskSensitiveYaml("wifi:\n  password: hunter2  # old pass swordfish");
    expect(masked).not.toContain("hunter2");
    expect(masked).not.toContain("swordfish");
    expect(masked).toContain("  password: •  # •");
  });

  it("masks a trailing comment beside a preserved value", () => {
    const yaml = [
      "wifi:",
      "  password: !secret wifi_password # hunter2",
      "ota:",
      "  password: ${ota_pass} # abcdef",
      "mqtt:",
      "  password: | # old pass qwerty",
      "    body-line",
    ].join("\n");
    const masked = maskSensitiveYaml(yaml);
    expect(masked).not.toContain("hunter2");
    expect(masked).not.toContain("abcdef");
    expect(masked).not.toContain("qwerty");
    expect(masked).toContain("  password: !secret wifi_password # •");
    expect(masked).toContain("  password: ${ota_pass} # •");
    expect(masked).toContain("  password: | # •");
  });

  it("masks block-scalar bodies under heuristic-named keys", () => {
    const yaml = "substitutions:\n  wifi_password: |\n    hunter2\nsensor:";
    const masked = maskSensitiveYaml(yaml);
    expect(masked).not.toContain("hunter2");
    expect(masked).toContain("  wifi_password: |");
    expect(masked).toContain("sensor:");
  });

  it("masks a literal that merely starts with !secret", () => {
    const masked = maskSensitiveYaml("wifi:\n  password: !secretsauce123");
    expect(masked).not.toContain("secretsauce123");
  });

  it("masks commented-out block-scalar credential bodies", () => {
    const yaml = [
      "wifi:",
      "  # password: |",
      "  #   hunter2",
      "  #   second-line",
      "  # note: keep",
      "sensor:",
    ].join("\n");
    const masked = maskSensitiveYaml(yaml);
    expect(masked).not.toContain("hunter2");
    expect(masked).not.toContain("second-line");
    expect(masked).toContain("  # password: |");
    expect(masked).toContain("  # note: keep");
    expect(masked).toContain("sensor:");
  });

  it("bounds commented block bodies by comment-content indent", () => {
    const yaml = [
      "wifi:",
      "  # password: |",
      "  #   user: bob",
      "  #   hunter2",
      "  # plain note after the block",
      "sensor:",
    ].join("\n");
    const masked = maskSensitiveYaml(yaml);
    expect(masked).not.toContain("user: bob");
    expect(masked).not.toContain("hunter2");
    expect(masked).toContain("  # plain note after the block");
    expect(masked).toContain("sensor:");
  });

  it("masks a comment-only value on a credential key", () => {
    const masked = maskSensitiveYaml("wifi:\n  password: # hunter2");
    expect(masked).not.toContain("hunter2");
    expect(masked).toContain("  password: # •");
  });

  it("masks user-named *_password / *_psk substitution keys", () => {
    const yaml = [
      "substitutions:",
      "  wifi_password: hunter2",
      "  vpn_psk: abcdef",
      "  friendly_name: Garage",
    ].join("\n");
    const masked = maskSensitiveYaml(yaml);
    expect(masked).not.toContain("hunter2");
    expect(masked).not.toContain("abcdef");
    expect(masked).toContain("  friendly_name: Garage");
  });

  it("masks hyphen and dot spellings of credential keys", () => {
    const yaml = ["wifi-password: hunter2", "vpn.psk: abcdef"].join("\n");
    const masked = maskSensitiveYaml(yaml);
    expect(masked).not.toContain("hunter2");
    expect(masked).not.toContain("abcdef");
    expect(masked).toContain("wifi-password: •");
    expect(masked).toContain("vpn.psk: •");
  });

  it("leaves non-credential key: fields alone", () => {
    const yaml = "remote_receiver:\n  key: 0x12345678";
    expect(maskSensitiveYaml(yaml)).toBe(yaml);
  });
});
