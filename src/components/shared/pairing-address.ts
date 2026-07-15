import { mdiContentCopy } from "@mdi/js";
import { html, nothing, type TemplateResult } from "lit";
import type { IdentityView } from "../../api/types/remote-build.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { copyToClipboard } from "../../util/copy-to-clipboard.js";
import { notify } from "../../util/notify.js";
import { formatHostPort, pairingAddress } from "../../util/pairing-address.js";
import { registerMdiIcons } from "../../util/register-icons.js";

registerMdiIcons({ "content-copy": mdiContentCopy });

/**
 * The pairing address as a disclosure: the advertised hostname:port
 * always visible, the raw advertised IP:port lines behind the native
 * chevron, every line with its own copy button. Plain line when no
 * IPs are advertised; nothing while the listener is down. Pair with
 * `pairingAddressStyles`.
 */
export function renderPairingAddress(
  localize: LocalizeFunc,
  identity: IdentityView | null
): TemplateResult | typeof nothing {
  const address = pairingAddress(identity);
  if (!address) return nothing;
  const addresses = identity?.listener_addresses ?? [];
  if (!addresses.length) return _addressLine(localize, address);
  const port = identity!.listener_port!;
  return html`
    <details class="pairing-address">
      <summary>${_addressLine(localize, address)}</summary>
      ${addresses.map((a) =>
        _addressLine(localize, formatHostPort(a, port), "pairing-address-ip")
      )}
    </details>
  `;
}

function _addressLine(
  localize: LocalizeFunc,
  value: string,
  extraClass = ""
): TemplateResult {
  return html`
    <span class="pairing-address-line ${extraClass}">
      <code @click=${_preventToggle}>${value}</code>
      <button
        type="button"
        class="pairing-address-copy"
        aria-label=${localize("settings.remote_build_address_copy_aria", {
          address: value,
        })}
        title=${localize("settings.remote_build_address_copy")}
        @click=${(e: Event) => _copyAddress(e, localize, value)}
      >
        <wa-icon library="mdi" name="content-copy"></wa-icon>
      </button>
    </span>
  `;
}

function _preventToggle(e: Event): void {
  // Keep the address text selectable: a click that ends a manual
  // drag-select inside the summary must not toggle the disclosure.
  e.preventDefault();
}

async function _copyAddress(
  e: Event,
  localize: LocalizeFunc,
  value: string
): Promise<void> {
  // Inside <summary>, a plain click would also toggle the disclosure.
  e.preventDefault();
  e.stopPropagation();
  if (await copyToClipboard(value)) {
    notify.success(localize("settings.remote_build_address_copied"));
  } else {
    notify.warning(localize("settings.remote_build_address_copy_failed"));
  }
}
