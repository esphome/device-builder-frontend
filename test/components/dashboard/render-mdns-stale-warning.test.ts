/**
 * Tests for the drawer's "not reachable via mDNS" warning.
 *
 * Pins ``renderMdnsStaleWarning`` — the collapsible the reachability
 * section mounts when a device is up over Ping/MQTT but isn't announcing
 * on mDNS, so the user knows why MAC / version / config-hash (and the
 * Modified / Update-available indicators) aren't refreshing. Only the
 * render condition and the localize keys are observable here; the live
 * mDNS state can't be toggled on the bench.
 */
import { nothing } from "lit";
import { describe, expect, it } from "vitest";
import { DeviceState } from "../../../src/api/types/devices.js";
import type { ReachabilityStateEvent } from "../../../src/api/types/reachability.js";
import { renderMdnsStaleWarning } from "../../../src/components/dashboard/device-drawer-render.js";
import { findTemplatesByAnchor, isTemplateResult } from "../../_lit-template-walker.js";

const _identityLocalize: (key: string) => string = (key) => key;

function reachability(
  overrides: Partial<ReachabilityStateEvent> = {}
): ReachabilityStateEvent {
  return {
    device: "dev",
    state: DeviceState.ONLINE,
    active_source: "ping",
    ip: "192.168.1.10",
    mdns_last_seen_seconds_ago: null,
    mdns_ttl_remaining_seconds: null,
    ping_last_seen_seconds_ago: 5,
    mqtt_last_seen_seconds_ago: null,
    ping_rtt_ms: 4.2,
    ...overrides,
  };
}

describe("renderMdnsStaleWarning", () => {
  it("warns when mDNS is dark but Ping is live", () => {
    const result = renderMdnsStaleWarning(reachability(), _identityLocalize);
    expect(isTemplateResult(result)).toBe(true);
    expect(findTemplatesByAnchor(result, "<details").length).toBe(1);
  });

  it("warns for an UNKNOWN-state device reachable over Ping", () => {
    // A Ping/MQTT-only device's online state is mDNS-driven, so it stays
    // UNKNOWN while reachable; the warning must still show (regression: a
    // strict ONLINE gate hid it until a reload caught a later snapshot).
    const result = renderMdnsStaleWarning(
      reachability({ state: DeviceState.UNKNOWN, active_source: "ping" }),
      _identityLocalize
    );
    expect(findTemplatesByAnchor(result, "<details").length).toBe(1);
  });

  it("warns when mDNS is dark but only MQTT is live", () => {
    const result = renderMdnsStaleWarning(
      reachability({
        active_source: "mqtt",
        ping_last_seen_seconds_ago: null,
        mqtt_last_seen_seconds_ago: 9,
        ping_rtt_ms: null,
      }),
      _identityLocalize
    );
    expect(findTemplatesByAnchor(result, "<details").length).toBe(1);
  });

  it("stays silent once mDNS has been seen", () => {
    const result = renderMdnsStaleWarning(
      reachability({ active_source: "mdns", mdns_last_seen_seconds_ago: 3 }),
      _identityLocalize
    );
    expect(result).toBe(nothing);
  });

  it("stays silent when no source is live (offline gets the waiting line)", () => {
    const result = renderMdnsStaleWarning(
      reachability({ ping_last_seen_seconds_ago: null, ping_rtt_ms: null }),
      _identityLocalize
    );
    expect(result).toBe(nothing);
  });

  it("stays silent for an offline snapshot with stale Ping/MQTT timestamps", () => {
    // *_last_seen_seconds_ago can carry historical timestamps after a
    // device goes offline; the "online over {source}" copy must not show.
    const result = renderMdnsStaleWarning(
      reachability({ state: DeviceState.OFFLINE, ping_last_seen_seconds_ago: 300 }),
      _identityLocalize
    );
    expect(result).toBe(nothing);
  });

  it("renders nothing for a null snapshot", () => {
    expect(renderMdnsStaleWarning(null, _identityLocalize)).toBe(nothing);
  });

  it("uses the summary and detail localize keys", () => {
    const keys: string[] = [];
    renderMdnsStaleWarning(reachability(), (key) => {
      keys.push(key);
      return key;
    });
    expect(keys).toContain("dashboard.drawer_mdns_stale_warning");
    expect(keys).toContain("dashboard.drawer_mdns_stale_detail");
  });

  // The detail string names the live channel via a {source} arg so it
  // reads "online over Ping/MQTT", not a generic "Ping or MQTT".
  function detailSourceArg(r: ReachabilityStateEvent): unknown {
    const calls: Array<[string, Record<string, unknown> | undefined]> = [];
    renderMdnsStaleWarning(r, (key, args) => {
      calls.push([key, args]);
      return key;
    });
    const detail = calls.find(([key]) => key === "dashboard.drawer_mdns_stale_detail");
    return detail?.[1]?.source;
  }

  it("names Ping as the source when the device is reachable over Ping", () => {
    expect(detailSourceArg(reachability({ active_source: "ping" }))).toBe(
      "dashboard.drawer_source_ping"
    );
  });

  it("names MQTT as the source when the device is reachable over MQTT", () => {
    expect(
      detailSourceArg(
        reachability({
          active_source: "mqtt",
          ping_last_seen_seconds_ago: null,
          mqtt_last_seen_seconds_ago: 9,
          ping_rtt_ms: null,
        })
      )
    ).toBe("dashboard.drawer_source_mqtt");
  });
});
