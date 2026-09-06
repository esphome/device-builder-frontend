/**
 * Pins the OTA encryption nudge gates: the device's mDNS TXT must report
 * Noise on a released 2026.9.0+ firmware, the dashboard's esphome must
 * accept the block, and the draft must carry a static api key and an
 * esphome OTA item without encryption.
 */
import { describe, expect, it } from "vitest";

import { makeConfiguredDevice } from "../_make-configured-device.js";
import { otaEncryptionNudge } from "../../src/util/ota-encryption-nudge.js";

const NOISE = "Noise_NNpsk0_25519_ChaChaPoly_SHA256";
const YAML = 'api:\n  encryption:\n    key: "abc"\nota:\n  - platform: esphome\n';
const PASSWORD_YAML = `${YAML}    password: x\n`;

const eligible = () =>
  makeConfiguredDevice({
    api_enabled: true,
    api_encrypted: true,
    runtime_state: { deployed_version: "2026.9.0", api_encryption_active: NOISE },
  });

const nudge = (overrides: Parameters<typeof otaEncryptionNudge>[0] = {} as never) =>
  otaEncryptionNudge({
    device: eligible(),
    yaml: YAML,
    esphomeVersion: "2026.9.0",
    ...overrides,
  });

describe("otaEncryptionNudge", () => {
  it("fires for a device reporting Noise on released 2026.9.0+", () => {
    expect(nudge()).toBe("add");
    expect(nudge({ yaml: PASSWORD_YAML })).toBe("replace_password");
    expect(
      nudge({
        device: {
          ...eligible(),
          runtime_state: { ...eligible().runtime_state, deployed_version: "2027.2.1" },
        },
      })
    ).toBe("add");
  });

  it("stays silent without the device or its mDNS evidence", () => {
    expect(nudge({ device: undefined })).toBeNull();
    for (const api_encryption_active of [null, ""]) {
      const device = eligible();
      device.runtime_state.api_encryption_active = api_encryption_active;
      expect(nudge({ device })).toBeNull();
    }
  });

  it("stays silent on firmware older than 2026.9.0 or not a release", () => {
    for (const deployed_version of ["", "2026.8.3", "2026.9.0b3", "2026.10.0-dev"]) {
      const device = eligible();
      device.runtime_state.deployed_version = deployed_version;
      expect(nudge({ device })).toBeNull();
    }
  });

  it("stays silent when the dashboard's esphome predates the block", () => {
    expect(nudge({ esphomeVersion: "2026.8.0" })).toBeNull();
    expect(nudge({ esphomeVersion: "" })).toBeNull();
  });

  it("stays silent without a static api key or an esphome OTA item", () => {
    expect(
      nudge({ yaml: "api:\n  encryption:\nota:\n  - platform: esphome\n" })
    ).toBeNull();
    expect(nudge({ yaml: 'api:\n  encryption:\n    key: "abc"\n' })).toBeNull();
    expect(nudge({ yaml: `${YAML}    encryption:\n` })).toBeNull();
  });
});
