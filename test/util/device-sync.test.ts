import { describe, expect, it } from "vitest";

import {
  deployedIdentityTrusted,
  showPendingChanges,
  showUpdateAvailable,
} from "../../src/util/device-sync.js";
import { makeConfiguredDevice } from "../_make-configured-device.js";

describe("device-sync mDNS gating", () => {
  it("trusts the deployed identity per api_enabled, live source, and identity evidence", () => {
    // Literal truth table (not the production expression) so a gate
    // regression can't hide behind a mirrored oracle. Two trusted
    // shapes only: the backend's first-party evidence flag, or an api
    // device under mdns ownership — a no-api device's mdns ownership
    // is a bare A-record resolve (reachability only) and earns nothing.
    const rows = [
      // [api_enabled, active_source, deployed_identity_live, trusted]
      [true, "mdns", true, true],
      [true, "mdns", false, true],
      [true, "ping", true, true],
      [true, "ping", false, false],
      [true, "mqtt", true, true],
      [true, "mqtt", false, false],
      [true, "unknown", true, true],
      [true, "unknown", false, false],
      [false, "mdns", true, true],
      [false, "mdns", false, false],
      [false, "ping", true, true],
      [false, "ping", false, false],
      [false, "mqtt", true, true],
      [false, "mqtt", false, false],
      [false, "unknown", true, true],
      [false, "unknown", false, false],
    ] as const;
    for (const [api_enabled, active_source, deployed_identity_live, trusted] of rows) {
      expect(
        deployedIdentityTrusted(
          makeConfiguredDevice({
            api_enabled,
            runtime_state: { active_source, deployed_identity_live },
          })
        )
      ).toBe(trusted);
    }
  });

  it("shows an api device's signals off Native-API evidence while mDNS is dark", () => {
    const probed = makeConfiguredDevice({
      api_enabled: true,
      runtime_state: { active_source: "ping", deployed_identity_live: true },
      has_pending_changes: true,
      pending_changes_via_hash: true,
      update_available: true,
    });
    expect(deployedIdentityTrusted(probed)).toBe(true);
    expect(showPendingChanges(probed)).toBe(true);
    expect(showUpdateAvailable(probed)).toBe(true);
  });

  it("hides an api device's hash-driven modified / update signals while mDNS is dark", () => {
    const dark = makeConfiguredDevice({
      api_enabled: true,
      runtime_state: { active_source: "ping", deployed_identity_live: false },
      has_pending_changes: true,
      pending_changes_via_hash: true,
      update_available: true,
    });
    expect(showPendingChanges(dark)).toBe(false);
    expect(showUpdateAvailable(dark)).toBe(false);
  });

  it("keeps an api device's local mtime-driven modified cue while mDNS is dark", () => {
    // pending_changes_via_hash absent / false ⇒ a local YAML edit, trustworthy
    // without mDNS, so the needs-install cue stays. update_available is still
    // mDNS-sourced, so it stays hidden.
    const dark = makeConfiguredDevice({
      api_enabled: true,
      runtime_state: { active_source: "ping", deployed_identity_live: false },
      has_pending_changes: true,
      update_available: true,
    });
    expect(showPendingChanges(dark)).toBe(true);
    expect(showUpdateAvailable(dark)).toBe(false);
  });

  it("shows the modified / update signals once mDNS is the live source", () => {
    const live = makeConfiguredDevice({
      api_enabled: true,
      runtime_state: { active_source: "mdns" },
      has_pending_changes: true,
      update_available: true,
    });
    expect(showPendingChanges(live)).toBe(true);
    expect(showUpdateAvailable(live)).toBe(true);
  });

  it("shows a no-api device's hash-driven modified / update signals without mDNS reachability", () => {
    const mqttOnly = makeConfiguredDevice({
      api_enabled: false,
      runtime_state: { active_source: "mqtt", deployed_identity_live: true },
      has_pending_changes: true,
      pending_changes_via_hash: true,
      update_available: true,
    });
    expect(showPendingChanges(mqttOnly)).toBe(true);
    expect(showUpdateAvailable(mqttOnly)).toBe(true);
  });

  it("hides a no-api device's hash-driven signals when the identity TXT went dark", () => {
    const dark = makeConfiguredDevice({
      api_enabled: false,
      runtime_state: { active_source: "mqtt", deployed_identity_live: false },
      has_pending_changes: true,
      pending_changes_via_hash: true,
      update_available: true,
    });
    expect(showPendingChanges(dark)).toBe(false);
    expect(showUpdateAvailable(dark)).toBe(false);
  });
});
