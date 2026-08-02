/** Shared `ReachabilityStateEvent` factory so the wire shape lives once. */
import { DeviceState } from "../src/api/types/devices.js";
import type { ReachabilityStateEvent } from "../src/api/types/reachability.js";

export function makeReachabilityEvent(
  overrides: Partial<ReachabilityStateEvent> = {}
): ReachabilityStateEvent {
  return {
    device: "kitchen",
    state: DeviceState.OFFLINE,
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
