/**
 * @vitest-environment happy-dom
 *
 * Pins the advertised-address precedence: mDNS host first, browser
 * hostname fallback, null while the listener is down.
 */

import { describe, expect, it } from "vitest";

import type { IdentityView } from "../../src/api/types/remote-build.js";
import { formatHostPort, pairingAddress } from "../../src/util/pairing-address.js";

const BASE: IdentityView = {
  dashboard_id: "dash-0",
  pin_sha256: "ab".repeat(32),
  server_version: "1.2.0",
  esphome_version: "2026.6.1",
  listener_bound: true,
};

describe("pairingAddress", () => {
  it("prefers the mDNS-advertised host", () => {
    expect(
      pairingAddress({
        ...BASE,
        listener_host: "esphome-builder-abc.local",
        listener_port: 6055,
      })
    ).toBe("esphome-builder-abc.local:6055");
  });

  it("falls back to the browser hostname without an advertiser", () => {
    expect(pairingAddress({ ...BASE, listener_host: null, listener_port: 6055 })).toBe(
      `${window.location.hostname}:6055`
    );
  });

  it("returns null while the listener is down or on pre-port backends", () => {
    expect(pairingAddress({ ...BASE, listener_port: null })).toBeNull();
    expect(pairingAddress(BASE)).toBeNull();
    expect(pairingAddress(null)).toBeNull();
  });
});

describe("formatHostPort", () => {
  it("brackets IPv6 literals", () => {
    expect(formatHostPort("192.168.1.5", 6055)).toBe("192.168.1.5:6055");
    expect(formatHostPort("fd00::a1", 6055)).toBe("[fd00::a1]:6055");
  });
});
