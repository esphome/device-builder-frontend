import { html, nothing, type TemplateResult } from "lit";
import { DeviceState } from "../../../api/types/devices.js";
import type { ReachabilitySource } from "../../../api/types/reachability.js";
import { activeLocale, type LocalizeFunc } from "../../../common/localize.js";
import { mdnsExpiryPhase, type MdnsExpiryPhase } from "../../../util/mdns-expiry.js";
import {
  ageOf,
  formatSecondsAgo,
  getNumberFormatter,
} from "../../../util/relative-time.js";
import type { ESPHomeDeviceDrawerContent } from "../device-drawer-content.js";
import {
  renderMdnsExpiry,
  renderMdnsStaleWarning,
  renderMdnsTxtRecords,
} from "../device-drawer-render.js";

interface ReachabilityRowSpec {
  source: "mdns" | "ping" | "mqtt";
  icon: string;
  labelKey: string;
  age: number | null;
  rttMs?: number | null;
  ttlPhase?: MdnsExpiryPhase;
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

  // The mDNS row's "Expires in N" countdown is the PTR record's full
  // lifetime minus how long since we last heard the device, so it
  // re-anchors in lockstep with "last seen" (both move off mdnsAge)
  // rather than the PTR's remaining TTL, which the browser refreshes
  // erratically and would drift against the actively-probed A record.
  // Held back until the device has been quiet a while (the quiet
  // threshold lives in mdnsExpiryPhase, which owns every gate) so a
  // healthy device shows no shrinking timer, and never shown once the
  // device is OFFLINE — by then it has already expired, and the
  // reachability snapshot can be stale (no push fires on the mDNS
  // Removed that took it offline), so trust the live device state.
  const mdnsAge = ageOf(r.mdns_last_seen_seconds_ago, anchor, now);
  const deviceOffline = host.device?.runtime_state.state === DeviceState.OFFLINE;
  const rows: ReachabilityRowSpec[] = [
    {
      source: "mdns",
      icon: "access-point-network",
      labelKey: "dashboard.drawer_source_mdns",
      age: mdnsAge,
      ttlPhase: mdnsExpiryPhase(
        mdnsAge,
        r.mdns_ptr_ttl_seconds,
        deviceOffline,
        r.active_source
      ),
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
      ${
        !anySignal
          ? html`<div class="value muted">
              ${host._localize("dashboard.drawer_waiting_for_signal")}
            </div>`
          : rows.map((row) =>
              renderReachabilityRow(row, r.active_source, lang, host._localize)
            )
      }
      ${renderMdnsStaleWarning(r, host._localize)}
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
          ${
            isActive
              ? html`<span class="reachability-badge"
                  >${localize("dashboard.drawer_source_active")}</span
                >`
              : nothing
          }
        </div>
        <div class="value">
          ${ageText}${
            rttText
              ? html` &middot; <span class="reachability-rtt">${rttText}</span>`
              : nothing
          }
        </div>
        ${
          row.source === "mdns" && row.ttlPhase
            ? renderMdnsExpiry(row.ttlPhase, localize, lang)
            : nothing
        }
        ${renderMdnsTxtRecords(row.txtRecords, localize)}
      </div>
    </div>
  `;
}
