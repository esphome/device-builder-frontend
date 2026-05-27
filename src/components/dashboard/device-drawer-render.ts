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
import type { LocalizeFunc } from "../../common/localize.js";

/**
 * Render the primary IP cell, optionally suffixed with a "Visit web UI"
 * icon-link.
 *
 * *url* is the precomputed ``buildWebUiUrl`` result for the device —
 * passed in (rather than recomputed) so the empty-IP guard in the
 * caller and this render share a single URL parse. An empty *url*
 * suppresses the link, mirroring the original "no link" branch.
 * Pass an empty *ip* to render the ``—`` placeholder alongside the
 * link; used in the "no resolved IPs yet but ``device.address`` is
 * known" branch so the visit affordance isn't gated on the first
 * mDNS A-record.
 */
export function renderIpValue(ip: string, url: string, localize: LocalizeFunc) {
  const isPlaceholder = !ip;
  const display = ip || "—";
  if (!url) {
    return html`<div class="value mono ${isPlaceholder ? "muted" : ""}">${display}</div>`;
  }
  const visitLabel = localize("dashboard.action_visit_web_ui");
  return html`
    <div class="value mono ip-value ${isPlaceholder ? "muted" : ""}">
      <span class="ip-value-text">${display}</span>
      <a
        class="ip-visit-link"
        href=${url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label=${visitLabel}
        title=${visitLabel}
      >
        <wa-icon library="mdi" name="open-in-new"></wa-icon>
      </a>
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
  // Pick the singular / plural variant at the call site (the
  // pattern this codebase already uses for ``discovered_count_*``)
  // — the localize helper has no plural-rules support, so a single
  // ``record(s)``-style template would render ungrammatically for
  // any locale that needs different word forms beyond English's
  // simple ±s rule.
  const summaryKey =
    entries.length === 1
      ? "dashboard.drawer_show_mdns_txt_records_singular"
      : "dashboard.drawer_show_mdns_txt_records_plural";
  return html`
    <details class="mdns-txt-details">
      <summary>${localize(summaryKey, { count: entries.length })}</summary>
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
