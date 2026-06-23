/**
 * Stateless renderers for the device drawer.
 *
 * Lives in a sibling file (rather than inside ``device-drawer-content.ts``)
 * so the unit tests can import the renderer without dragging in
 * ``webawesome``'s side-effect modules — those reach for DOM globals
 * (``CSSStyleSheet``, ``customElements``) that the vitest ``node``
 * environment doesn't define. The renderer itself only needs ``lit``
 * and the localize signature.
 */
import { html, nothing } from "lit";
import { DeviceState } from "../../api/types/devices.js";
import type { ReachabilityStateEvent } from "../../api/types/reachability.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { renderVisitWebUiLink } from "../../util/visit-web-ui-link.js";

/**
 * Render a hostname or IP value cell, optionally suffixed with a
 * "Visit web UI" icon-link.
 *
 * *url* is the precomputed ``buildWebUiUrl`` result for the host —
 * passed in (rather than recomputed) so the empty-value guard in the
 * caller and this render share a single URL parse. An empty *url*
 * suppresses the link. Pass an empty *value* to render the ``—``
 * placeholder alongside the link.
 */
export function renderAddressValue(value: string, url: string, localize: LocalizeFunc) {
  const isPlaceholder = !value;
  const display = value || "—";
  if (!url) {
    return html`<div class="value mono ${isPlaceholder ? "muted" : ""}">${display}</div>`;
  }
  return html`
    <div class="value mono address-value ${isPlaceholder ? "muted" : ""}">
      <span class="address-value-text">${display}</span>
      ${renderVisitWebUiLink(url, localize, { className: "address-visit-link" })}
    </div>
  `;
}

/**
 * Render the chevron-collapsible carrying the device's mDNS TXT
 * record key/value pairs.
 *
 * Mounted under the mDNS row in the drawer's reachability section
 * so users can debug "is the device actually broadcasting what I
 * expect?" — version mismatches, missing
 * ``api_encryption`` entries, stale ``mac`` advertisements — without
 * dropping to ``avahi-browse`` / ``dns-sd``. Closed by default
 * because this is debug-only metadata; the row stays compact in
 * the common case.
 *
 * Returns ``nothing`` when *records* is ``null``, ``undefined``,
 * or empty so older backends (no ``mdns_txt_records`` field on the
 * wire) and devices with no TXT cached are visually unchanged
 * from the pre-feature drawer — collapses to literally zero
 * markup.
 *
 * Injection-safety: every key/value is interpolated via Lit's
 * default ``${...}`` escaping, which renders strings as text
 * content, not HTML. We deliberately don't put any TXT data into
 * element attributes (no ``href`` / ``style`` / ``title``) — even
 * a malicious device firmware advertising ``<script>`` payloads
 * in TXT can only render as visible text, never as executable
 * markup.
 */
export function renderMdnsTxtRecords(
  records: Record<string, string> | null | undefined,
  localize: LocalizeFunc
) {
  if (records === null || records === undefined) return nothing;
  const entries = Object.entries(records);
  if (entries.length === 0) return nothing;
  // Sort for stable rendering across re-pushes. The backend's
  // ``decoded_properties`` walk preserves insertion order from
  // the TXT record bytes, but the user-facing row order should
  // be deterministic regardless of how the device serialised
  // its TXT entries (or which order zeroconf cached them).
  entries.sort(([a], [b]) => a.localeCompare(b));
  return html`
    <details class="mdns-txt-details">
      <summary>
        ${localize("dashboard.drawer_show_mdns_txt_records", { count: entries.length })}
      </summary>
      <dl class="mdns-txt-list">
        ${entries.map(
          ([key, value]) => html`
            <dt>${key}</dt>
            <dd>${value}</dd>
          `
        )}
      </dl>
    </details>
  `;
}

/**
 * Render the collapsible warning shown when a device is reachable but
 * the dashboard can't see it over mDNS (different subnet, no mDNS
 * reflector, …) — not an assertion the device stopped announcing.
 *
 * MAC address, ESPHome version, and config hash are read from the mDNS
 * TXT payload, so on a Ping/MQTT-only device the cached values (and the
 * Modified / Update-available indicators derived from them) may be
 * stale. The drawer's per-row "Waiting for mDNS discovery…" text doesn't
 * explain why; this surfaces the reason once, in the same `<details>`
 * chevron idiom as ``renderMdnsTxtRecords`` so it sits naturally in the
 * section.
 *
 * Returns ``nothing`` unless mDNS has never been seen
 * (``mdns_last_seen_seconds_ago === null``) while another source is
 * live and the device is not OFFLINE. UNKNOWN counts: a Ping/MQTT-only
 * device's online state is mDNS-driven, so it sits at UNKNOWN even while
 * reachable — exactly the case this warns about. OFFLINE is excluded
 * because the Ping/MQTT timestamps linger as stale history once a device
 * drops; a fully-offline device gets the existing "Waiting for first
 * signal…" line, and a device heard over mDNS isn't stale.
 */
export function renderMdnsStaleWarning(
  reachability: ReachabilityStateEvent | null,
  localize: LocalizeFunc
) {
  if (reachability === null) return nothing;
  // Exclude only OFFLINE, not "not ONLINE": a device reachable solely over
  // Ping/MQTT reports UNKNOWN (the online state is mDNS-driven), and that is
  // exactly the case this warns about. OFFLINE is excluded because the
  // *_last_seen_seconds_ago stamps linger as stale history once a device
  // drops, and "reachable over {source}" must not show for a dead device.
  if (reachability.state === DeviceState.OFFLINE) return nothing;
  const mdnsSeen = reachability.mdns_last_seen_seconds_ago !== null;
  const mqttSeen = reachability.mqtt_last_seen_seconds_ago !== null;
  const pingSeen = reachability.ping_last_seen_seconds_ago !== null;
  if (mdnsSeen || (!mqttSeen && !pingSeen)) return nothing;
  // Name the channel the device IS reachable on. active_source is the
  // priority winner (MQTT > Ping while mDNS is dark); fall back to
  // whichever is live if it isn't already one of those two.
  const viaMqtt =
    reachability.active_source === "mqtt" ||
    (reachability.active_source !== "ping" && mqttSeen);
  const source = localize(
    viaMqtt ? "dashboard.drawer_source_mqtt" : "dashboard.drawer_source_ping"
  );
  return html`
    <details class="reachability-warning">
      <summary>
        <wa-icon library="mdi" name="alert-circle-outline"></wa-icon>
        ${localize("dashboard.drawer_mdns_stale_warning")}
      </summary>
      <div class="reachability-warning-body">
        ${localize("dashboard.drawer_mdns_stale_detail", { source })}
      </div>
    </details>
  `;
}
