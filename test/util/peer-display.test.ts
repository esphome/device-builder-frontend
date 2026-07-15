// Pins the shared peer-row display helpers: the connected/disconnected
// pill mapping and the paired_at=0 guard.

import { describe, expect, it } from "vitest";
import { pairedAgoSeconds, peerConnectionPill } from "../../src/util/peer-display.js";

describe("peerConnectionPill", () => {
  it("maps connected to the connected class and label", () => {
    expect(peerConnectionPill(true)).toEqual({
      className: "peer-connection-pill peer-connection-connected",
      labelKey: "settings.build_server_peer_connected",
    });
  });

  it("maps disconnected to the disconnected class and label", () => {
    expect(peerConnectionPill(false)).toEqual({
      className: "peer-connection-pill peer-connection-disconnected",
      labelKey: "settings.build_server_peer_disconnected",
    });
  });
});

describe("pairedAgoSeconds", () => {
  it("returns seconds since a Unix-seconds paired_at", () => {
    expect(pairedAgoSeconds(1_000, 1_060_000)).toBe(60);
  });

  it("clamps clock skew to zero", () => {
    expect(pairedAgoSeconds(2_000, 1_000_000)).toBe(0);
  });

  it("returns null for a legacy/corrupt paired_at of 0", () => {
    expect(pairedAgoSeconds(0, 1_000_000)).toBeNull();
  });
});
