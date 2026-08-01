/** Pins the troubleshooting decision tree's branches and ordering. */
import { describe, expect, it } from "vitest";

import { makeConfiguredDevice } from "../_make-configured-device.js";
import type { ReachabilityStateEvent } from "../../src/api/types/reachability.js";
import type { DeviceTroubleshootResult } from "../../src/api/types/troubleshoot.js";
import {
  buildTroubleshootSections,
  type TroubleshootInput,
} from "../../src/util/troubleshoot-tree.js";

function makeResult(
  overrides: Partial<DeviceTroubleshootResult> = {}
): DeviceTroubleshootResult {
  return {
    configuration: "kitchen.yaml",
    address: "kitchen.local",
    icmp_available: true,
    zeroconf_running: true,
    dns_resolved: true,
    dns_addresses: ["10.0.0.42"],
    dns_had_cached_failure: false,
    dns_inconclusive: false,
    mdns_addresses: ["10.0.0.42"],
    mdns_has_cached_trace: true,
    mdns_has_live_anchor_ptr: true,
    mdns_inconclusive: false,
    ping_attempted: true,
    ping_target: "10.0.0.42",
    ping_target_source: "dns",
    ping_rtt_ms: 4.2,
    ...overrides,
  };
}

function makeReachability(
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
    ping_last_seen_seconds_ago: 30,
    mqtt_last_seen_seconds_ago: null,
    ping_rtt_ms: null,
    ...overrides,
  } as ReachabilityStateEvent;
}

function build(input: Partial<TroubleshootInput> = {}): string[] {
  return buildTroubleshootSections({
    device: makeConfiguredDevice(),
    reachability: null,
    result: null,
    inDocker: false,
    existingAddress: "",
    ...input,
  }).map((s) => s.id);
}

describe("buildTroubleshootSections", () => {
  it("short-circuits to untracked for a mac-suffix config", () => {
    const sections = buildTroubleshootSections({
      device: makeConfiguredDevice({ name_add_mac_suffix: true }),
      reachability: null,
      result: makeResult(),
      inDocker: false,
      existingAddress: "",
    });
    expect(sections.map((s) => s.id)).toEqual(["untracked"]);
    expect(sections[0].showUseAddressForm).toBeUndefined();
  });

  it("falls back to generic advice plus the use_address form", () => {
    expect(build({ result: makeResult() })).toEqual(["generic", "use_address"]);
  });

  it("keeps the basics under a deep-sleep explainer", () => {
    expect(
      build({
        device: makeConfiguredDevice({ uses_deep_sleep: true }),
        result: makeResult(),
      })
    ).toEqual(["deep_sleep", "generic", "use_address"]);
  });

  it("flags an ICMP-less deployment", () => {
    expect(build({ result: makeResult({ icmp_available: false }) })).toContain(
      "icmp_unavailable"
    );
  });

  it("zeroconf-down suppresses the mdns_dark diagnosis", () => {
    const ids = build({
      device: makeConfiguredDevice({ api_enabled: true }),
      result: makeResult({
        zeroconf_running: false,
        mdns_addresses: [],
        mdns_has_cached_trace: false,
      }),
    });
    expect(ids).toContain("zeroconf_down");
    expect(ids).not.toContain("mdns_dark");
  });

  it("diagnoses mdns_dark for an api device the browser never heard", () => {
    const sections = buildTroubleshootSections({
      device: makeConfiguredDevice({ api_enabled: true }),
      reachability: makeReachability(),
      result: makeResult({ mdns_addresses: [], mdns_has_cached_trace: false }),
      inDocker: false,
      existingAddress: "",
    });
    const dark = sections.find((s) => s.id === "mdns_dark");
    expect(dark?.bodyKeys).toEqual([
      "troubleshoot.mdns_dark_body",
      "troubleshoot.mdns_dark_vlan_body",
    ]);
  });

  it("leads mdns_dark with host networking when in Docker", () => {
    const sections = buildTroubleshootSections({
      device: makeConfiguredDevice({ api_enabled: true }),
      reachability: makeReachability(),
      result: makeResult({ mdns_addresses: [], mdns_has_cached_trace: false }),
      inDocker: true,
      existingAddress: "",
    });
    const dark = sections.find((s) => s.id === "mdns_dark");
    expect(dark?.bodyKeys[0]).toBe("troubleshoot.mdns_dark_docker_body");
    expect(dark?.docsUrl).toContain("docker");
  });

  it("skips mdns_dark once mDNS has been heard", () => {
    expect(
      build({
        device: makeConfiguredDevice({ api_enabled: true }),
        reachability: makeReachability({ mdns_last_seen_seconds_ago: 12 }),
        result: makeResult({ mdns_addresses: [], mdns_has_cached_trace: false }),
      })
    ).not.toContain("mdns_dark");
  });

  it("flags a stale MQTT link only for mqtt configs", () => {
    const stale = makeReachability({ mqtt_last_seen_seconds_ago: null });
    expect(
      build({ device: makeConfiguredDevice({ uses_mqtt: true }), reachability: stale })
    ).toContain("mqtt");
    expect(
      build({
        device: makeConfiguredDevice({ uses_mqtt: true }),
        reachability: makeReachability({ mqtt_last_seen_seconds_ago: 5 }),
      })
    ).not.toContain("mqtt");
    expect(build({ reachability: stale })).not.toContain("mqtt");
  });

  it("a set use_address supersedes the mdns and dynamic-ip diagnoses", () => {
    const ids = build({
      device: makeConfiguredDevice({ api_enabled: true, ip: "10.0.0.42" }),
      result: makeResult({
        mdns_addresses: [],
        mdns_has_cached_trace: false,
        ping_rtt_ms: null,
      }),
      existingAddress: "4.4.4.4",
    });
    expect(ids).toContain("use_address_set");
    expect(ids).not.toContain("mdns_dark");
    expect(ids).not.toContain("dynamic_ip");
    expect(ids).not.toContain("generic");
  });

  it("flags an unverified reply at the last known address", () => {
    const ids = build({
      result: makeResult({
        dns_resolved: false,
        dns_addresses: [],
        mdns_addresses: [],
        mdns_has_cached_trace: false,
        ping_target_source: "last_known",
      }),
    });
    expect(ids).toContain("unverified_ping");
  });

  it("keeps a live-resolved reply unqualified", () => {
    expect(build({ result: makeResult() })).not.toContain("unverified_ping");
  });

  it("flags a live resolve failure without waiting for the sweep's cache", () => {
    expect(
      build({ result: makeResult({ dns_resolved: false, dns_addresses: [] }) })
    ).toContain("dns_fail");
  });

  it("flags a cached DNS failure and a dead last-known IP", () => {
    const ids = build({
      device: makeConfiguredDevice({ ip: "10.0.0.42" }),
      result: makeResult({
        dns_resolved: false,
        dns_addresses: [],
        dns_had_cached_failure: true,
        dns_inconclusive: false,
        ping_rtt_ms: null,
      }),
    });
    expect(ids).toContain("dns_fail");
    expect(ids).toContain("dynamic_ip");
    expect(ids[ids.length - 1]).toBe("use_address");
  });
});
