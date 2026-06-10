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
