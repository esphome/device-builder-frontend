/**
 * Per-device reachability subscription events.
 *
 * Part of the src/api/types.ts barrel split.
 */
import { DeviceState } from "./devices.js";

// ─── Per-device reachability subscription ─────────────────

/** Channel a reachability observation came in on. Mirrors the
 *  backend's source-priority enum — the device drawer renders one
 *  row per source the device has been observed on. */
export type ReachabilitySource = "mdns" | "ping" | "mqtt" | "unknown";

/**
 * Wire shape pushed by ``devices/subscribe_reachability`` events.
 *
 * The drawer subscribes per-device while open so every connected
 * client doesn't get a periodic freshness heartbeat. Each
 * ``*_last_seen_seconds_ago`` field is ``null`` when that signal
 * has never been observed for this device — the drawer hides
 * those rows. ``active_source`` is the channel currently driving
 * the device's online/offline state (mDNS > MQTT > Ping); it
 * gets the "active" badge in the UI but doesn't change which
 * rows are visible. ``ping_rtt_ms`` is paired with the Ping row
 * and is ``null`` until the first successful probe.
 */
export interface ReachabilityStateEvent {
  device: string;
  state: DeviceState;
  active_source: ReachabilitySource;
  ip: string;
  /** Seconds since the device's last ``_esphomelib._tcp.local.``
   *  SRV announce, read live from ``zeroconf.cache.created``.
   *  Truthful even when ``ServiceStateChange.Updated`` doesn't
   *  fire (zeroconf suppresses callbacks for same-content TTL
   *  refreshes); ``null`` when zeroconf isn't running or the
   *  device hasn't been heard from at all. */
  mdns_last_seen_seconds_ago: number | null;
  /** Seconds the cached SRV record has left before
   *  ``zeroconf`` evicts it without a refreshing announce.
   *  Surfaced beside the mDNS row as a TTL bar / countdown
   *  so the user can tell "due to re-announce" from "missed
   *  several windows already". ``null`` when ``mdns_last_seen``
   *  is null. */
  mdns_ttl_remaining_seconds: number | null;
  /** Decoded TXT key/value pairs from the device's
   *  ``_esphomelib._tcp.local.`` TXT record — same payload the
   *  dashboard already mines for ``version`` / ``config_hash`` /
   *  ``mac`` / ``api_encryption``. The drawer renders these
   *  inside a chevron-collapsible under the mDNS row so users
   *  can debug "is the device actually broadcasting what I
   *  expect?" without dropping to ``avahi-browse`` /
   *  ``dns-sd``. ``null`` when no TXT record is cached (drawer
   *  hides the section entirely); empty mapping is normalised
   *  to ``null`` upstream. Empty-string values are meaningful —
   *  zeroconf collapses bare keys and ``key=`` empty-value
   *  entries to the same shape, so the backend surfaces both as
   *  ``""`` (the ``api_encryption=`` "device confirmed
   *  plaintext" tri-state signal lives here). Optional because
   *  older backend builds don't emit the field — the drawer
   *  treats undefined the same as ``null``. */
  mdns_txt_records?: Record<string, string> | null;
  ping_last_seen_seconds_ago: number | null;
  mqtt_last_seen_seconds_ago: number | null;
  ping_rtt_ms: number | null;
}

/** Result from devices/subscribe_reachability — same shape as
 *  subscribe_events: a one-shot ack that the listener is live. */
export interface SubscribeReachabilityResult {
  subscribed: boolean;
}

/** Handle returned by ``ESPHomeAPI.subscribeDeviceReachability``.
 *  Call ``unsubscribe()`` when the drawer closes — best-effort,
 *  network failures are swallowed since the per-stream task is
 *  also cancelled by the WS disconnect anyway. */
export interface ReachabilitySubscription {
  unsubscribe: () => Promise<void>;
}
