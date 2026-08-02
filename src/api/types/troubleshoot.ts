/**
 * Wire shape of the `devices/troubleshoot` on-demand probe.
 *
 * Part of the src/api/types.ts barrel split.
 */

/** Where the probe found its ping target. */
export type PingTargetSource = "" | "dns" | "mdns" | "runtime" | "persisted";

export interface DeviceTroubleshootResult {
  configuration: string;
  /** Hostname the backend targets (effective `use_address`, or `<name>.local`). */
  address: string;
  /** `null` while the backend's startup ICMP privilege probe hasn't landed. */
  icmp_available: boolean | null;
  zeroconf_running: boolean;
  dns_resolved: boolean;
  dns_addresses: string[];
  /** The leg failed internally; its fields prove nothing. */
  dns_inconclusive: boolean;
  /** Zeroconf-cached addresses after the probe's wire mDNS re-query. */
  mdns_addresses: string[];
  /** Any cached mDNS record for the device, expired included. */
  mdns_has_cached_trace: boolean;
  mdns_inconclusive: boolean;
  ping_attempted: boolean;
  ping_target: string;
  /** `persisted` is the sidecar last-known IP: its reply proves
   *  reachability of the address, not identity, and the backend never
   *  applies a verdict from it. */
  ping_target_source: PingTargetSource;
  /** `null` = attempted and unreachable. */
  ping_rtt_ms: number | null;
}
