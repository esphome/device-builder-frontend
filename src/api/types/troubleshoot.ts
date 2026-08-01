/**
 * Wire shape of the `devices/troubleshoot` on-demand probe.
 *
 * Part of the src/api/types.ts barrel split.
 */

export interface DeviceTroubleshootResult {
  configuration: string;
  /** Hostname the backend targets (effective `use_address`, or `<name>.local`). */
  address: string;
  /** `null` while the backend's startup ICMP privilege probe hasn't landed. */
  icmp_available: boolean | null;
  zeroconf_running: boolean;
  dns_resolved: boolean;
  dns_addresses: string[];
  /** The passive sweep's cached DNS verdict from before this probe ran. */
  dns_had_cached_failure: boolean;
  /** Zeroconf-cached addresses after the probe's wire mDNS re-query. */
  mdns_addresses: string[];
  /** Any cached mDNS record for the device, expired included. */
  mdns_has_cached_trace: boolean;
  mdns_has_live_anchor_ptr: boolean;
  ping_attempted: boolean;
  ping_target: string;
  /** "dns" / "mdns" = live resolve; "last_known" = persisted address,
   *  so a reply proves reachability of the address, not identity. */
  ping_target_source: string;
  /** `null` = attempted and unreachable. */
  ping_rtt_ms: number | null;
}
