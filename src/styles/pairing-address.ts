/**
 * Shared `<details class="pairing-address">` disclosure styling.
 *
 * The advertised hostname:port is the always-visible summary; the raw
 * IP:port lines sit behind the native chevron (same disclosure idiom
 * as `pin-hex`). Rendered by `renderPairingAddress`; drop this
 * fragment into each consumer's `static styles` array.
 */
import { css } from "lit";

export const pairingAddressStyles = css`
  .pairing-address summary {
    cursor: pointer;
    user-select: none;
  }

  .pairing-address summary code {
    color: var(--wa-color-text-normal);
  }

  .pairing-address-ip {
    display: block;
    margin-top: 4px;
    color: var(--wa-color-text-quiet);
    line-height: 1.5;
  }
`;
