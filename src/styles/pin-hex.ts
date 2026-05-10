/**
 * Shared `<details class="pin-hex">` disclosure styling.
 *
 * The same disclosure widget appears below the emoji
 * fingerprint in three places that all need to look identical:
 * the receiver-side accept-peer dialog, the sender-side
 * pair-build-server confirm step, and the receiver's own Build
 * server identity card. Every site renders:
 *
 * ```html
 * <details class="pin-hex">
 *   <summary>Show hex bytes</summary>
 *   <code>ab cd ef …</code>
 * </details>
 * ```
 *
 * Adding a new site? Drop this fragment into the consumer's
 * `static styles` array; consumer-specific extras (extra
 * `margin-top`, monospace `font-family` override, etc.) stay
 * inline at the call site rather than baking into the shared
 * sheet. Don't fold those extras in here just because they're
 * trivial; cross-site drift is the failure mode this fragment
 * exists to prevent and consumer-specific tweaks are healthy.
 */
import { css } from "lit";

export const pinHexStyles = css`
  .pin-hex {
    font-size: var(--wa-font-size-xs);
    color: var(--wa-color-text-quiet);
  }

  .pin-hex summary {
    cursor: pointer;
    user-select: none;
  }

  .pin-hex code {
    display: block;
    margin-top: 4px;
    color: var(--wa-color-text-normal);
    line-height: 1.5;
  }
`;
