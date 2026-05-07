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
import { html } from "lit";
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
export function renderIpValue(
  ip: string,
  url: string,
  localize: LocalizeFunc,
) {
  const isPlaceholder = !ip;
  const display = ip || "—";
  if (!url) {
    return html`<div
      class="value mono ${isPlaceholder ? "muted" : ""}"
    >${display}</div>`;
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
