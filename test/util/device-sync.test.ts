import { describe, expect, it } from "vitest";

import {
  mdnsOnline,
  showPendingChanges,
  showUpdateAvailable,
} from "../../src/util/device-sync.js";
import { makeConfiguredDevice } from "../_make-configured-device.js";

describe("device-sync mDNS gating", () => {
  it("is mDNS-online only when the live source is mDNS", () => {
    expect(mdnsOnline(makeConfiguredDevice({ active_source: "mdns" }))).toBe(true);
    for (const s of ["ping", "mqtt", "unknown"] as const) {
      expect(mdnsOnline(makeConfiguredDevice({ active_source: s }))).toBe(false);
    }
    // Absent on the wire (older / unclaimed) reads as not mDNS.
    expect(mdnsOnline(makeConfiguredDevice({ active_source: undefined }))).toBe(false);
  });

  it("hides the hash-driven modified / update signals while mDNS is dark", () => {
    const dark = makeConfiguredDevice({
      active_source: "ping",
      has_pending_changes: true,
      pending_changes_via_hash: true,
      update_available: true,
    });
    expect(showPendingChanges(dark)).toBe(false);
    expect(showUpdateAvailable(dark)).toBe(false);
  });

  it("keeps a local mtime-driven modified cue while mDNS is dark", () => {
    // pending_changes_via_hash absent / false ⇒ a local YAML edit, trustworthy
    // without mDNS, so the needs-install cue stays. update_available is still
    // mDNS-sourced, so it stays hidden.
    const dark = makeConfiguredDevice({
      active_source: "ping",
      has_pending_changes: true,
      update_available: true,
    });
    expect(showPendingChanges(dark)).toBe(true);
    expect(showUpdateAvailable(dark)).toBe(false);
  });

  it("shows the modified / update signals once mDNS is the live source", () => {
    const live = makeConfiguredDevice({
      active_source: "mdns",
      has_pending_changes: true,
      update_available: true,
    });
    expect(showPendingChanges(live)).toBe(true);
    expect(showUpdateAvailable(live)).toBe(true);
  });
});
