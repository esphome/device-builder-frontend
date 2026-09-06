/**
 * Pins the draft line scans for the esphome OTA platform item and the
 * static api key, and the rewrite that adds a bare `encryption:` while
 * dropping `password:`.
 */
import { describe, expect, it } from "vitest";

import {
  dropOtaEncryptionKeyInYaml,
  enableOtaEncryptionInYaml,
  hasStaticApiKey,
  otaEsphomeFacts,
} from "../../src/util/yaml-ota-encryption.js";

const API_KEY =
  'api:\n  encryption:\n    key: "a2V5a2V5a2V5a2V5a2V5a2V5a2V5a2V5a2V5a2V5a2V5a2U="\n';
const PLAIN_OTA = "ota:\n  - platform: esphome\n";
const PASSWORD_OTA =
  "ota:\n  - platform: esphome\n    password: !secret ota_password\n    port: 3232\n";
const ENCRYPTED_OTA = "ota:\n  - platform: esphome\n    encryption:\n";
const OWN_KEY_OTA =
  'ota:\n  - platform: esphome\n    encryption:\n      key: "abc"  # own\n    port: 3232\n';
const MAPPING_OTA = "ota:\n  platform: esphome\n  password: x\n";

describe("otaEsphomeFacts", () => {
  it("reports encryption and password as direct children", () => {
    expect(otaEsphomeFacts(PLAIN_OTA)).toEqual({
      present: true,
      hasEncryption: false,
      hasPassword: false,
      hasOwnKey: false,
    });
    expect(otaEsphomeFacts(PASSWORD_OTA)).toMatchObject({
      hasPassword: true,
      hasEncryption: false,
    });
    expect(otaEsphomeFacts(ENCRYPTED_OTA)).toMatchObject({
      hasEncryption: true,
      hasOwnKey: false,
    });
    expect(otaEsphomeFacts(OWN_KEY_OTA)).toMatchObject({
      hasEncryption: true,
      hasOwnKey: true,
    });
    expect(otaEsphomeFacts(MAPPING_OTA)).toMatchObject({
      present: true,
      hasPassword: true,
    });
    expect(otaEsphomeFacts("")).toEqual({
      present: false,
      hasEncryption: false,
      hasPassword: false,
      hasOwnKey: false,
    });
  });

  it("finds the esphome item among other platforms and ignores nested platforms", () => {
    expect(
      otaEsphomeFacts(
        "ota:\n  - platform: web_server\n  - platform: esphome\n    port: 1\n"
      )
    ).toMatchObject({ present: true, hasEncryption: false });
    expect(otaEsphomeFacts("ota:\n  - platform: web_server\n")).toMatchObject({
      present: false,
    });
    expect(
      otaEsphomeFacts("sensor:\n  - platform: esphome\nota:\n  - platform: web_server\n")
    ).toMatchObject({ present: false });
  });

  it("survives a bare dash placeholder while typing", () => {
    expect(otaEsphomeFacts("ota:\n  -\n")).toMatchObject({ present: false });
    expect(otaEsphomeFacts("ota:\n  - \n  - platform: esphome\n")).toMatchObject({
      present: true,
      hasEncryption: false,
    });
    expect(enableOtaEncryptionInYaml("ota:\n  -\n")).toBeNull();
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

  it("rejects a bare !secret tag with no name", () => {
    expect(hasStaticApiKey("api:\n  encryption:\n    key: !secret\n")).toBe(false);
    expect(hasStaticApiKey("api:\n  encryption:\n    key: !secret  # todo\n")).toBe(
      false
    );
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

  it("removes every duplicate password line", () => {
    const yaml =
      "ota:\n  - platform: esphome\n    password: a\n    port: 1\n    password: b\n";
    expect(enableOtaEncryptionInYaml(yaml)).toBe(
      "ota:\n  - platform: esphome\n    encryption:\n    port: 1\n"
    );
  });

  it("inserts after platform on a bare-dash item and in the mapping form", () => {
    expect(
      enableOtaEncryptionInYaml("ota:\n  -\n    platform: esphome\n    port: 1\n")
    ).toBe("ota:\n  -\n    platform: esphome\n    encryption:\n    port: 1\n");
    expect(enableOtaEncryptionInYaml("ota:\n  id: my_ota\n  platform: esphome\n")).toBe(
      "ota:\n  id: my_ota\n  platform: esphome\n  encryption:\n"
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

describe("dropOtaEncryptionKeyInYaml", () => {
  it("removes only the key line, leaving a bare encryption block", () => {
    expect(dropOtaEncryptionKeyInYaml(OWN_KEY_OTA)).toBe(
      "ota:\n  - platform: esphome\n    encryption:\n    port: 3232\n"
    );
  });

  it("removes every duplicate key line", () => {
    const yaml =
      "ota:\n  - platform: esphome\n    encryption:\n      key: a\n      key: b\n";
    expect(dropOtaEncryptionKeyInYaml(yaml)).toBe(
      "ota:\n  - platform: esphome\n    encryption:\n"
    );
  });

  it("returns null without an own key", () => {
    expect(dropOtaEncryptionKeyInYaml(ENCRYPTED_OTA)).toBeNull();
    expect(dropOtaEncryptionKeyInYaml(PLAIN_OTA)).toBeNull();
    expect(dropOtaEncryptionKeyInYaml(API_KEY)).toBeNull();
  });
});

describe("line endings", () => {
  it("keeps CRLF documents CRLF through both rewrites", () => {
    const crlf = PASSWORD_OTA.replace(/\n/g, "\r\n");
    expect(enableOtaEncryptionInYaml(crlf)).toBe(
      "ota:\r\n  - platform: esphome\r\n    encryption:\r\n    port: 3232\r\n"
    );
    const ownKeyCrlf = OWN_KEY_OTA.replace(/\n/g, "\r\n");
    expect(dropOtaEncryptionKeyInYaml(ownKeyCrlf)).toBe(
      "ota:\r\n  - platform: esphome\r\n    encryption:\r\n    port: 3232\r\n"
    );
  });
});
