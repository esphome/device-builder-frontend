import { describe, expect, it } from "vitest";

import {
  devicePendingChanges,
  deviceUpdateAvailable,
  mdnsOnline,
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

  it("hides the modified / update signals while mDNS is dark", () => {
    const dark = makeConfiguredDevice({
      active_source: "ping",
      has_pending_changes: true,
      update_available: true,
    });
    expect(devicePendingChanges(dark)).toBe(false);
    expect(deviceUpdateAvailable(dark)).toBe(false);
  });

  it("shows the modified / update signals once mDNS is the live source", () => {
    const live = makeConfiguredDevice({
      active_source: "mdns",
      has_pending_changes: true,
      update_available: true,
    });
    expect(devicePendingChanges(live)).toBe(true);
    expect(deviceUpdateAvailable(live)).toBe(true);
  });
});
