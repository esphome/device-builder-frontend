/**
 * Tests for the reachability section's mDNS-expiry wiring.
 *
 * ``renderMdnsExpiry`` / ``formatCountdown`` are unit-tested with
 * pre-computed values; this pins the glue in ``renderReachabilitySection``
 * that a real bug would hide in: the ``lifetime - age`` subtraction, the
 * ``mdns_ptr_ttl_seconds === null`` gate, and the render-site gate that
 * only shows the countdown when mDNS is the active source. Asserted via a
 * capturing localize so the countdown / lifetime args are observable
 * without walking the template.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeviceState } from "../../../src/api/types/devices.js";
import type { ReachabilityStateEvent } from "../../../src/api/types/reachability.js";
import type { ESPHomeDeviceDrawerContent } from "../../../src/components/dashboard/device-drawer-content.js";
import { renderReachabilitySection } from "../../../src/components/dashboard/device-drawer-content/reachability.js";

// Pin the locale to en so formatCountdown's Intl.NumberFormat emits Latin
// digits ("1h 10m"); otherwise activeLocale() resolves the host locale and a
// non-Latin-digit environment would make the expectations flaky.
vi.mock("../../../src/common/localize.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/common/localize.js")>()),
  activeLocale: () => "en",
}));

const NOW = 1_000_000;

function reachability(
  overrides: Partial<ReachabilityStateEvent> = {}
): ReachabilityStateEvent {
  return {
    device: "dev",
    state: DeviceState.ONLINE,
    active_source: "mdns",
    ip: "192.168.1.10",
    mdns_last_seen_seconds_ago: 300,
    mdns_ttl_remaining_seconds: 110,
    mdns_ptr_ttl_seconds: 4500,
    mdns_txt_records: null,
    ping_last_seen_seconds_ago: null,
    mqtt_last_seen_seconds_ago: null,
    ping_rtt_ms: null,
    ...overrides,
  };
}

// Renders the section against a fake host, returning the localize calls so
// the expiry summary/explainer args are observable. Anchor == NOW (frozen
// clock) makes the rendered mDNS age exactly mdns_last_seen_seconds_ago.
function renderCalls(
  r: ReachabilityStateEvent,
  deviceState: DeviceState = DeviceState.ONLINE
): Array<[string, Record<string, unknown> | undefined]> {
  const calls: Array<[string, Record<string, unknown> | undefined]> = [];
  const host = {
    device: { state: deviceState },
    _reachability: r,
    _reachabilityAnchorMs: NOW,
    _localize: (key: string, args?: Record<string, unknown>) => {
      calls.push([key, args]);
      return key;
    },
  } as unknown as ESPHomeDeviceDrawerContent;
  renderReachabilitySection(host);
  return calls;
}

describe("renderReachabilitySection — mDNS expiry wiring", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("shows the countdown as lifetime minus age when mDNS is the active source", () => {
    // 4500s lifetime, last heard 300s ago → 4200s remaining = 1h 10m.
    const calls = renderCalls(reachability());
    const summary = calls.find(([k]) => k === "dashboard.drawer_mdns_expires_in");
    const explainer = calls.find(
      ([k]) => k === "dashboard.drawer_mdns_expires_explainer"
    );
    expect(summary?.[1]?.t).toBe("1h 10m");
    expect(explainer?.[1]?.lifetime).toBe("1h 15m");
  });

  it("says 'expires soon' once the lifetime has elapsed (no stuck 0s)", () => {
    const calls = renderCalls(
      reachability({ mdns_ptr_ttl_seconds: 200, mdns_last_seen_seconds_ago: 500 })
    );
    expect(calls.some(([k]) => k === "dashboard.drawer_mdns_expires_soon")).toBe(true);
    expect(calls.some(([k]) => k === "dashboard.drawer_mdns_expires_in")).toBe(false);
  });

  it("never shows the countdown when the device is offline, even with a stale snapshot", () => {
    // The mDNS Removed that took the device offline fires no reachability
    // push, so the snapshot can still say mdns/active with a lifetime; the
    // live device state must win and hide the (already-expired) countdown.
    const calls = renderCalls(reachability(), DeviceState.OFFLINE);
    expect(calls.some(([k]) => k === "dashboard.drawer_mdns_expires_in")).toBe(false);
  });

  it("hides the countdown while the device was heard recently", () => {
    // A freshly-heard healthy device (age below the hint threshold) gets no
    // shrinking timer; the hint only appears once it has been quiet a while.
    const calls = renderCalls(reachability({ mdns_last_seen_seconds_ago: 30 }));
    expect(calls.some(([k]) => k === "dashboard.drawer_mdns_expires_in")).toBe(false);
  });

  it("hides the countdown when mDNS is not the active source", () => {
    const calls = renderCalls(reachability({ active_source: "ping" }));
    expect(calls.some(([k]) => k === "dashboard.drawer_mdns_expires_in")).toBe(false);
  });

  it("hides the countdown when no PTR lifetime is known", () => {
    const calls = renderCalls(reachability({ mdns_ptr_ttl_seconds: null }));
    expect(calls.some(([k]) => k === "dashboard.drawer_mdns_expires_in")).toBe(false);
  });
});
