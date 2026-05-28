import { describe, expect, it } from "vitest";
import type { PairingSummary } from "../../src/api/types.js";
import {
  classifyNoCompatiblePeerReason,
  classifyVersionMismatch,
} from "../../src/util/version-mismatch.js";

function pairing(overrides: Partial<PairingSummary>): PairingSummary {
  return {
    receiver_hostname: "build.local",
    receiver_port: 6055,
    pin_sha256: "a".repeat(64),
    label: "desktop",
    paired_at: 1,
    status: "approved",
    connected: true,
    connecting: false,
    last_connect_error: "",
    esphome_version: "2026.5.0",
    enabled: true,
    ...overrides,
  };
}

describe("classifyVersionMismatch", () => {
  it("returns null when versions match exactly", () => {
    expect(classifyVersionMismatch("2026.5.0", "2026.5.0")).toBeNull();
  });

  it("returns null when either side is empty (handshake not yet complete)", () => {
    expect(classifyVersionMismatch("", "2026.5.0")).toBeNull();
    expect(classifyVersionMismatch("2026.5.0", "")).toBeNull();
    expect(classifyVersionMismatch("", "")).toBeNull();
  });

  it("classifies patch-level differences", () => {
    expect(classifyVersionMismatch("2026.5.0", "2026.5.1")).toBe("patch");
    expect(classifyVersionMismatch("2026.5.1", "2026.5.0")).toBe("patch");
  });

  it("classifies suffix-only differences (beta / dev) as patch-level", () => {
    expect(classifyVersionMismatch("2026.5.0", "2026.5.0b1")).toBe("patch");
    expect(classifyVersionMismatch("2026.5.0", "2026.5.0-dev")).toBe("patch");
  });

  it("classifies year+month differences as release-level", () => {
    expect(classifyVersionMismatch("2026.5.0", "2026.4.0")).toBe("release");
    expect(classifyVersionMismatch("2026.5.0", "2026.6.0")).toBe("release");
    expect(classifyVersionMismatch("2026.12.0", "2027.1.0")).toBe("release");
  });

  it("classifies cross-year differences as release-level", () => {
    expect(classifyVersionMismatch("2026.5.0", "2025.12.0")).toBe("release");
  });

  it("treats beta receiver against stable offloader as patch when same release", () => {
    // Receiver might be running a beta build the offloader hasn't
    // moved to yet; the YAML schemas are typically compatible at
    // that point so the operator should see this as patch-level,
    // not release-level.
    expect(classifyVersionMismatch("2026.5.0", "2026.5.0b3")).toBe("patch");
  });
});

describe("classifyNoCompatiblePeerReason", () => {
  const LOCAL = "2026.5.0";

  it("returns 'mixed' when no operator-intentional pairings exist", () => {
    expect(classifyNoCompatiblePeerReason([], LOCAL)).toBe("mixed");
  });

  it("ignores PENDING + disabled rows (not operator-intentional)", () => {
    const pairings = [
      pairing({ status: "pending", connected: false }),
      pairing({ enabled: false, esphome_version: "2026.4.0" }),
    ];
    expect(classifyNoCompatiblePeerReason(pairings, LOCAL)).toBe("mixed");
  });

  it("returns 'offline' when every intentional pairing is disconnected", () => {
    const pairings = [
      pairing({ connected: false }),
      pairing({ connected: false, pin_sha256: "b".repeat(64) }),
    ];
    expect(classifyNoCompatiblePeerReason(pairings, LOCAL)).toBe("offline");
  });

  it("returns 'version' when every intentional pairing is connected but on a wrong version", () => {
    const pairings = [
      pairing({ esphome_version: "2026.4.0" }),
      pairing({ esphome_version: "2026.6.0", pin_sha256: "b".repeat(64) }),
    ];
    expect(classifyNoCompatiblePeerReason(pairings, LOCAL)).toBe("version");
  });

  it("returns 'mixed' when reasons differ across peers", () => {
    const pairings = [
      pairing({ connected: false }),
      pairing({ esphome_version: "2026.4.0", pin_sha256: "b".repeat(64) }),
    ];
    expect(classifyNoCompatiblePeerReason(pairings, LOCAL)).toBe("mixed");
  });

  it("returns 'mixed' when every intentional pairing is eligible (shouldn't reach helper)", () => {
    // Defensive: caller only invokes the classifier on a
    // NO_COMPATIBLE_PEER error, but if the snapshot races ahead
    // of the error the classifier shouldn't pretend to know why.
    expect(classifyNoCompatiblePeerReason([pairing({})], LOCAL)).toBe("mixed");
  });
});
