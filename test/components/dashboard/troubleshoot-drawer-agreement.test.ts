/**
 * Pins the cross-surface contract: any snapshot the drawer renders an
 * mDNS row for must never produce the troubleshoot dialog's mdns_dark
 * ("No mDNS traffic from this device") diagnosis, and vice versa.
 */
import { describe, expect, it, vi } from "vitest";

import { makeConfiguredDevice } from "../../_make-configured-device.js";
import { DeviceState } from "../../../src/api/types/devices.js";
import type { ReachabilityStateEvent } from "../../../src/api/types/reachability.js";
import type { DeviceTroubleshootResult } from "../../../src/api/types/troubleshoot.js";
import type { ESPHomeDeviceDrawerContent } from "../../../src/components/dashboard/device-drawer-content.js";
import { renderReachabilitySection } from "../../../src/components/dashboard/device-drawer-content/reachability.js";
import { buildTroubleshootSections } from "../../../src/util/troubleshoot-tree.js";

// Pin the locale so the row's age formatting never depends on the host.
vi.mock("../../../src/common/localize.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/common/localize.js")>()),
  activeLocale: () => "en",
}));

// A probe that heard nothing: without live reachability evidence this
// shape is exactly what mdns_dark diagnoses.
const DARK_PROBE: DeviceTroubleshootResult = {
  configuration: "kitchen.yaml",
  address: "kitchen.local",
  icmp_available: true,
  zeroconf_running: true,
  dns_resolved: true,
  dns_addresses: ["10.0.0.42"],
  dns_had_cached_failure: false,
  dns_inconclusive: false,
  mdns_addresses: [],
  mdns_has_cached_trace: false,
  mdns_has_live_anchor_ptr: false,
  mdns_inconclusive: false,
  ping_attempted: true,
  ping_target: "10.0.0.42",
  ping_target_source: "dns",
  ping_rtt_ms: null,
};

function reachability(
  overrides: Partial<ReachabilityStateEvent> = {}
): ReachabilityStateEvent {
  return {
    device: "kitchen",
    state: "offline",
    active_source: "ping",
    ip: "10.0.0.42",
    mdns_last_seen_seconds_ago: null,
    mdns_ttl_remaining_seconds: null,
    mdns_ptr_ttl_seconds: null,
    mdns_txt_records: null,
    ping_last_seen_seconds_ago: 30,
    mqtt_last_seen_seconds_ago: null,
    ping_rtt_ms: null,
    ...overrides,
  } as ReachabilityStateEvent;
}

function drawerShowsMdnsRow(r: ReachabilityStateEvent): boolean {
  const keys: string[] = [];
  const host = {
    device: { runtime_state: { state: DeviceState.OFFLINE } },
    _reachability: r,
    _reachabilityAnchorMs: Date.now(),
    _localize: (key: string) => {
      keys.push(key);
      return key;
    },
  } as unknown as ESPHomeDeviceDrawerContent;
  renderReachabilitySection(host);
  return keys.includes("dashboard.drawer_source_mdns");
}

function treeSaysDark(r: ReachabilityStateEvent): boolean {
  return buildTroubleshootSections({
    device: makeConfiguredDevice(),
    reachability: r,
    result: DARK_PROBE,
    inDocker: false,
    existingAddress: "",
  }).some((s) => s.id === "mdns_dark");
}

describe("drawer mDNS row vs troubleshoot mdns_dark", () => {
  it("never diagnoses mdns_dark for a snapshot the drawer shows an mDNS row for", () => {
    for (const overrides of [
      { mdns_last_seen_seconds_ago: 12 },
      // Very stale is still "heard": neither surface applies a
      // staleness threshold, and neither may gain one alone.
      { mdns_last_seen_seconds_ago: 100_000 },
      // Expired PTR lifetime keeps the row (with the expiry note).
      { mdns_last_seen_seconds_ago: 500, mdns_ptr_ttl_seconds: 200 },
      { mdns_last_seen_seconds_ago: 3, active_source: "mdns" as const },
    ]) {
      const r = reachability(overrides);
      expect(drawerShowsMdnsRow(r)).toBe(true);
      expect(treeSaysDark(r)).toBe(false);
    }
  });

  it("diagnoses mdns_dark exactly when the drawer shows no mDNS row", () => {
    const r = reachability({ mdns_last_seen_seconds_ago: null });
    expect(drawerShowsMdnsRow(r)).toBe(false);
    expect(treeSaysDark(r)).toBe(true);
  });
});
