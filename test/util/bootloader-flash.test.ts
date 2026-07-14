import { describe, expect, it } from "vitest";

import { canFlashBootloader } from "../../src/util/bootloader-flash.js";
import { makeConfiguredDevice } from "../_make-configured-device.js";

describe("canFlashBootloader", () => {
  it("requires the YAML flag and a deployed firmware built from the current config", () => {
    expect(
      canFlashBootloader(
        makeConfiguredDevice({
          ota_partition_access: true,
          expected_config_hash: "aa11bb22",
          runtime_state: { deployed_config_hash: "aa11bb22" },
        })
      )
    ).toBe(true);
  });

  it("stays off without the flag, without hashes, on a hash mismatch, or without a device", () => {
    expect(
      canFlashBootloader(
        makeConfiguredDevice({
          expected_config_hash: "aa11bb22",
          runtime_state: { deployed_config_hash: "aa11bb22" },
        })
      )
    ).toBe(false);
    expect(
      canFlashBootloader(
        makeConfiguredDevice({
          ota_partition_access: true,
          expected_config_hash: "aa11bb22",
          runtime_state: { deployed_config_hash: "ff00ff00" },
        })
      )
    ).toBe(false);
    expect(
      canFlashBootloader(
        makeConfiguredDevice({
          ota_partition_access: true,
          expected_config_hash: "",
          runtime_state: { deployed_config_hash: "" },
        })
      )
    ).toBe(false);
    expect(canFlashBootloader(null)).toBe(false);
    expect(canFlashBootloader(undefined)).toBe(false);
  });
});
