/**
 * Pins the draft line scans for the esphome OTA platform item and the
 * static api key, and the rewrite that adds a bare `encryption:` while
 * dropping `password:`.
 */
import { describe, expect, it } from "vitest";

import {
  enableOtaEncryptionInYaml,
  findOtaEsphomeItem,
  hasStaticApiKey,
  otaEsphomeFacts,
} from "../../src/util/yaml-ota-encryption.js";

const API_KEY =
  'api:\n  encryption:\n    key: "a2V5a2V5a2V5a2V5a2V5a2V5a2V5a2V5a2V5a2V5a2V5a2U="\n';
const PLAIN_OTA = "ota:\n  - platform: esphome\n";
const PASSWORD_OTA =
  "ota:\n  - platform: esphome\n    password: !secret ota_password\n    port: 3232\n";
const ENCRYPTED_OTA = "ota:\n  - platform: esphome\n    encryption:\n";
const MAPPING_OTA = "ota:\n  platform: esphome\n  password: x\n";

describe("findOtaEsphomeItem", () => {
  it("finds the esphome item among other platforms", () => {
    const lines =
      "ota:\n  - platform: web_server\n  - platform: esphome\n    port: 1\n".split("\n");
    expect(findOtaEsphomeItem(lines)).toEqual({ line: 2, childIndent: "    " });
  });

  it("handles the legacy bare mapping form", () => {
    expect(findOtaEsphomeItem(MAPPING_OTA.split("\n"))).toEqual({
      line: 0,
      childIndent: "  ",
    });
  });

  it("returns null without an ota block or without the esphome platform", () => {
    expect(findOtaEsphomeItem(API_KEY.split("\n"))).toBeNull();
    expect(findOtaEsphomeItem("ota:\n  - platform: web_server\n".split("\n"))).toBeNull();
    expect(findOtaEsphomeItem("ota:\n  platform: web_server\n".split("\n"))).toBeNull();
  });

  it("ignores a nested esphome platform elsewhere", () => {
    const lines =
      "sensor:\n  - platform: esphome\nota:\n  - platform: web_server\n".split("\n");
    expect(findOtaEsphomeItem(lines)).toBeNull();
  });
});

describe("otaEsphomeFacts", () => {
  it("reports encryption and password as direct children", () => {
    expect(otaEsphomeFacts(PLAIN_OTA)).toEqual({
      present: true,
      hasEncryption: false,
      hasPassword: false,
    });
    expect(otaEsphomeFacts(PASSWORD_OTA)).toMatchObject({
      hasPassword: true,
      hasEncryption: false,
    });
    expect(otaEsphomeFacts(ENCRYPTED_OTA)).toMatchObject({ hasEncryption: true });
    expect(otaEsphomeFacts(MAPPING_OTA)).toMatchObject({
      present: true,
      hasPassword: true,
    });
    expect(otaEsphomeFacts("")).toEqual({
      present: false,
      hasEncryption: false,
      hasPassword: false,
    });
  });

  it("does not read a sibling platform's password", () => {
    const yaml =
      "ota:\n  - platform: esphome\n  - platform: http_request\n    password: y\n";
    expect(otaEsphomeFacts(yaml)).toMatchObject({ present: true, hasPassword: false });
  });
});

describe("hasStaticApiKey", () => {
  it("accepts a literal, a secret, and a substitution", () => {
    expect(hasStaticApiKey(API_KEY)).toBe(true);
    expect(hasStaticApiKey("api:\n  encryption:\n    key: !secret api_key\n")).toBe(true);
    expect(hasStaticApiKey("api:\n  encryption:\n    key: ${api_key}\n")).toBe(true);
  });

  it("rejects a runtime-provisioned block and a missing api", () => {
    expect(hasStaticApiKey("api:\n  encryption:\n")).toBe(false);
    expect(hasStaticApiKey("api:\n  encryption:\n    key:\n")).toBe(false);
    expect(hasStaticApiKey('api:\n  encryption:\n    key: ""\n')).toBe(false);
    expect(hasStaticApiKey("api:\n  port: 6053\n")).toBe(false);
    expect(hasStaticApiKey(PLAIN_OTA)).toBe(false);
  });
});

describe("enableOtaEncryptionInYaml", () => {
  it("adds a bare encryption block after the platform line", () => {
    expect(enableOtaEncryptionInYaml(PLAIN_OTA)).toBe(
      "ota:\n  - platform: esphome\n    encryption:\n"
    );
  });

  it("replaces the password line in place, keeping siblings", () => {
    expect(enableOtaEncryptionInYaml(PASSWORD_OTA)).toBe(
      "ota:\n  - platform: esphome\n    encryption:\n    port: 3232\n"
    );
  });

  it("handles the bare mapping form", () => {
    expect(enableOtaEncryptionInYaml(MAPPING_OTA)).toBe(
      "ota:\n  platform: esphome\n  encryption:\n"
    );
  });

  it("returns null when already encrypted or without an item", () => {
    expect(enableOtaEncryptionInYaml(ENCRYPTED_OTA)).toBeNull();
    expect(enableOtaEncryptionInYaml(API_KEY)).toBeNull();
  });

  it("leaves other sections untouched", () => {
    const yaml = `${API_KEY}\n${PASSWORD_OTA}\nwifi:\n  ssid: x\n`;
    const out = enableOtaEncryptionInYaml(yaml)!;
    expect(out.startsWith(API_KEY)).toBe(true);
    expect(out.endsWith("wifi:\n  ssid: x\n")).toBe(true);
    expect(out).not.toContain("ota_password");
  });
});
