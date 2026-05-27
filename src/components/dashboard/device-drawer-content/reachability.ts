import { html, nothing, type TemplateResult } from "lit";
import { activeLocale, type LocalizeFunc } from "../../../common/localize.js";
import type { ReachabilitySource, ReachabilityStateEvent } from "../../../api/types.js";
import type { ESPHomeAPI } from "../../../api/esphome-api.js";
import {
  ageOf,
  formatSecondsAgo,
  getNumberFormatter,
} from "../../../util/relative-time.js";
import { renderMdnsTxtRecords } from "../device-drawer-render.js";
import type { ESPHomeDeviceDrawerContent } from "../device-drawer-content.js";

interface ReachabilityRowSpec {
  source: "mdns" | "ping" | "mqtt";
  icon: string;
  labelKey: string;
  age: number | null;
  rttMs?: number | null;
  txtRecords?: Record<string, string> | null;
}

export function renderReachabilitySection(
  host: ESPHomeDeviceDrawerContent
): TemplateResult | typeof nothing {
  const r = host._reachability;
  if (r === null) return nothing;

  const lang = activeLocale();
  const now = Date.now();
  const anchor = host._reachabilityAnchorMs;

  // mdns_ttl_remaining_seconds isn't surfaced — the backend's refresh loop
  // drives it back to ~120s on every probe, so the value would be a function
  // of when our tick last fired, not the device's announce expiry.
  const rows: ReachabilityRowSpec[] = [
    {
      source: "mdns",
      icon: "access-point-network",
      labelKey: "dashboard.drawer_source_mdns",
      age: ageOf(r.mdns_last_seen_seconds_ago, anchor, now),
      txtRecords: r.mdns_txt_records ?? null,
    },
    {
      source: "ping",
      icon: "lan",
      labelKey: "dashboard.drawer_source_ping",
      age: ageOf(r.ping_last_seen_seconds_ago, anchor, now),
      rttMs: r.ping_rtt_ms,
    },
    {
      source: "mqtt",
      icon: "message",
      labelKey: "dashboard.drawer_source_mqtt",
      age: ageOf(r.mqtt_last_seen_seconds_ago, anchor, now),
    },
  ];
  const anySignal = rows.some((row) => row.age !== null);

  return html`
    <div class="section">
      <h4 class="section-title">${host._localize("dashboard.drawer_reachability")}</h4>
      ${!anySignal
        ? html`<div class="value muted">
            ${host._localize("dashboard.drawer_waiting_for_signal")}
          </div>`
        : rows.map((row) =>
            renderReachabilityRow(row, r.active_source, lang, host._localize)
          )}
    </div>
  `;
}

function renderReachabilityRow(
  row: ReachabilityRowSpec,
  activeSource: ReachabilitySource,
  lang: string | undefined,
  localize: LocalizeFunc
): TemplateResult | typeof nothing {
  if (row.age === null) return nothing;
  const ageText = formatSecondsAgo(row.age, lang);
  // RTT keeps 1 decimal — 4.2 ms vs 4 ms is meaningful for a LAN ping.
  const rttFmt = getNumberFormatter(lang, 1);
  const rttText =
    row.rttMs === null || row.rttMs === undefined
      ? null
      : localize("dashboard.drawer_round_trip_ms", {
          n: rttFmt.format(row.rttMs),
        });
  const isActive = activeSource === row.source;
  return html`
    <div class="row">
      <div class="icon">
        <wa-icon library="mdi" name=${row.icon}></wa-icon>
      </div>
      <div class="content">
        <div class="label">
          ${localize(row.labelKey)}
          ${isActive
            ? html`<span class="reachability-badge"
                >${localize("dashboard.drawer_source_active")}</span
              >`
            : nothing}
        </div>
        <div class="value">
          ${ageText}${rttText
            ? html` &middot; <span class="reachability-rtt">${rttText}</span>`
            : nothing}
        </div>
        ${renderMdnsTxtRecords(row.txtRecords, localize)}
      </div>
    </div>
  `;
}

// Reconcile (open / close / swap) the per-device subscription against
// (drawerOpen, device.name, api). Called from updated() and the 1Hz tick
// (which catches WS reconnects — the API clears event listeners on close so
// the stale _subscribedDevice would otherwise block resubscribe).
export function reconcileSubscription(host: ESPHomeDeviceDrawerContent): void {
  const wantName = host.drawerOpen && host.device && host._api ? host.device.name : null;
  const currentGeneration = host._api?.connectionGeneration ?? 0;
  const generationChanged =
    host._subscribedDevice !== null && currentGeneration !== host._subscribedGeneration;
  if (wantName === host._subscribedDevice && !generationChanged) return;

  teardownSubscription(host);
  if (wantName === null || host._api === undefined) return;

  // Skip if we already failed on this exact (device, gen). Permanent errors
  // (NOT_FOUND, INVALID_ARGS) would otherwise re-fire every tick. The key
  // resets when device selection changes or WS reconnects.
  const targetKey = `${wantName}:${currentGeneration}`;
  if (host._failedSubscribeKey === targetKey) return;

  host._subscribedDevice = wantName;
  host._subscribedGeneration = currentGeneration;
  void openSubscription(host, wantName, currentGeneration, targetKey, host._api);
}

async function openSubscription(
  host: ESPHomeDeviceDrawerContent,
  deviceName: string,
  attemptGeneration: number,
  attemptKey: string,
  api: ESPHomeAPI
): Promise<void> {
  // A WS reconnect (gen bump) or different-device selection between
  // subscribe-start and resolve/reject makes this attempt stale; catch
  // must not mutate state belonging to the newer attempt; success must
  // unsubscribe the just-created handle.
  const isCurrent = (): boolean =>
    host._subscribedDevice === deviceName &&
    host._subscribedGeneration === attemptGeneration;

  try {
    const subscription = await api.subscribeDeviceReachability(
      deviceName,
      (state: ReachabilityStateEvent) => {
        if (!isCurrent()) return;
        host._reachability = state;
        host._reachabilityAnchorMs = Date.now();
      }
    );
    if (!isCurrent()) {
      void subscription.unsubscribe();
      return;
    }
    host._subscription = subscription;
    host._failedSubscribeKey = null;
  } catch (err) {
    // Rate-limit the warning — the 1Hz tick retries reconcile, and during
    // a WS-not-yet-connected window each retry would also log.
    if (host._loggedFailureKey !== attemptKey) {
      host._loggedFailureKey = attemptKey;
      console.warn("subscribeDeviceReachability failed", err);
    }
    if (isCurrent()) {
      host._failedSubscribeKey = attemptKey;
      host._subscribedDevice = null;
    }
  }
}

export function teardownSubscription(host: ESPHomeDeviceDrawerContent): void {
  host._subscribedDevice = null;
  host._reachability = null;
  host._reachabilityAnchorMs = 0;
  if (host._subscription !== null) {
    const sub = host._subscription;
    host._subscription = null;
    void sub.unsubscribe();
  }
}

// 1Hz tick: rendered values resolve at second precision. Probes for WS
// reconnect / failed-initial-subscribe via reconcileSubscription on every tick.
export function syncTickInterval(host: ESPHomeDeviceDrawerContent): void {
  const wantTick =
    host.drawerOpen && host.device !== undefined && host._api !== undefined;
  if (wantTick && host._tickInterval === null) {
    host._tickInterval = setInterval(() => {
      host._tick = (host._tick + 1) % 1000;
      reconcileSubscription(host);
    }, 1000);
  } else if (!wantTick && host._tickInterval !== null) {
    clearInterval(host._tickInterval);
    host._tickInterval = null;
  }
}
