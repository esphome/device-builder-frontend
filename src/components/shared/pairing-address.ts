import { html, nothing, type TemplateResult } from "lit";
import type { IdentityView } from "../../api/types/remote-build.js";
import { formatHostPort, pairingAddress } from "../../util/pairing-address.js";

/**
 * The pairing address as a disclosure: the advertised hostname:port
 * always visible, the raw advertised IP:port lines behind the native
 * chevron. Plain `<code>` when no IPs are advertised; nothing while
 * the listener is down. Pair with `pairingAddressStyles`.
 */
export function renderPairingAddress(
  identity: IdentityView | null
): TemplateResult | typeof nothing {
  const address = pairingAddress(identity);
  if (!address) return nothing;
  const addresses = identity?.listener_addresses ?? [];
  if (!addresses.length) return html`<code>${address}</code>`;
  const port = identity!.listener_port!;
  return html`
    <details class="pairing-address">
      <summary><code>${address}</code></summary>
      ${addresses.map(
        (a) => html`<code class="pairing-address-ip">${formatHostPort(a, port)}</code>`
      )}
    </details>
  `;
}
