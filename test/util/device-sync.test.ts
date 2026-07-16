import { describe, expect, it } from "vitest";

import {
  deployedIdentityTrusted,
  showPendingChanges,
  showUpdateAvailable,
} from "../../src/util/device-sync.js";
import { makeConfiguredDevice } from "../_make-configured-device.js";

describe("device-sync mDNS gating", () => {
  it("trusts the deployed identity per api_enabled and live source", () => {
    // An api device needs a live mDNS; a no-api device's identity arrives
    // over _http._tcp, which never claims reachability, so active_source
    // can't vouch for it and the delivered value is trusted as-is.
    for (const s of ["mdns", "ping", "mqtt", "unknown"] as const) {
      for (const api_enabled of [true, false]) {
        expect(
          deployedIdentityTrusted(
            makeConfiguredDevice({ api_enabled, runtime_state: { active_source: s } })
          )
        ).toBe(api_enabled ? s === "mdns" : true);
      }
    }
  });

  it("hides an api device's hash-driven modified / update signals while mDNS is dark", () => {
    const dark = makeConfiguredDevice({
      api_enabled: true,
      runtime_state: { active_source: "ping" },
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
      runtime_state: { active_source: "ping" },
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
      runtime_state: { active_source: "mqtt" },
      has_pending_changes: true,
      pending_changes_via_hash: true,
      update_available: true,
    });
    expect(showPendingChanges(mqttOnly)).toBe(true);
    expect(showUpdateAvailable(mqttOnly)).toBe(true);
  });
});
