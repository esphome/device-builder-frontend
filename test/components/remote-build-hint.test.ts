import { describe, expect, it } from "vitest";

import type { PairingSummary } from "../../src/api/types/remote-build.js";
import { canResetBuildEnv } from "../../src/components/remote-build-hint.js";

function pairing(overrides: Partial<PairingSummary> = {}): PairingSummary {
  return {
    receiver_hostname: "mac.local",
    receiver_port: 6055,
    pin_sha256: "a".repeat(64),
    label: "mac",
    paired_at: 1,
    status: "approved",
    connected: true,
    connecting: false,
    last_connect_error: "",
    esphome_version: "2026.6.5",
    enabled: true,
    auto_provision_supported: false,
    friendly_name: "",
    ha_addon: false,
    reset_build_env_supported: true,
    ...overrides,
  };
}

describe("canResetBuildEnv", () => {
  it("is true for an approved, connected, capable pairing", () => {
    expect(canResetBuildEnv(pairing())).toBe(true);
  });

  it("is false without the capability, when disconnected, or when pending", () => {
    expect(canResetBuildEnv(pairing({ reset_build_env_supported: false }))).toBe(false);
    expect(canResetBuildEnv(pairing({ connected: false }))).toBe(false);
    expect(canResetBuildEnv(pairing({ status: "pending" }))).toBe(false);
  });
});
