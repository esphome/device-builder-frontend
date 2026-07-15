/**
 * Shared `<details class="pairing-address">` disclosure styling.
 *
 * The advertised hostname:port is the always-visible summary; the raw
 * IP:port lines sit behind the native chevron (same disclosure idiom
 * as `pin-hex`), each line with its own copy button. Rendered by
 * `renderPairingAddress`; drop this fragment into each consumer's
 * `static styles` array.
 */
import { css } from "lit";

export const pairingAddressStyles = css`
  .pairing-address summary {
    cursor: pointer;
    user-select: none;
  }

  /* The address itself stays hand-selectable: the summary's
     user-select none only covers the chevron/padding, and clicks on
     the text don't toggle the disclosure (see _preventToggle). */
  .pairing-address summary code,
  .pairing-address-line code {
    color: var(--wa-color-text-normal);
    user-select: text;
    cursor: text;
  }

  .pairing-address-line {
    display: inline-flex;
    align-items: center;
    gap: var(--wa-space-2xs);
  }

  .pairing-address-ip {
    display: flex;
    margin-top: 4px;
    color: var(--wa-color-text-quiet);
    line-height: 1.5;
  }

  .pairing-address-copy {
    display: inline-flex;
    align-items: center;
    padding: 2px;
    background: none;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    color: var(--wa-color-text-quiet);
    font-size: 14px;
  }

  .pairing-address-copy:hover,
  .pairing-address-copy:focus-visible {
    color: var(--esphome-primary);
  }

  .pairing-address-copy:focus-visible {
    outline: 2px solid var(--esphome-primary);
    outline-offset: -2px;
  }
`;
