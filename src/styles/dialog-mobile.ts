import { type CSSResult, css } from "lit";

import { MOBILE_BREAKPOINT } from "./breakpoints.js";

/**
 * Mobile-layout fragments for app dialogs (issue #41). Both size with `dvh`
 * (vh fallback) so they need no `viewport-fit=cover`.
 *
 * `::part()` pierces one shadow level, so the rule must live in the
 * component hosting the `<wa-dialog>`: pass `"wa-dialog"` for a raw dialog
 * (or base-dialog itself), `"esphome-base-dialog"` for a base-dialog
 * consumer. The outer tree wins the parts cascade, so a consumer's
 * fullscreen override beats base-dialog's centered default.
 */
type DialogHost = "wa-dialog" | "esphome-base-dialog";

// Pre-built so the host interpolates as a CSSResult (no unsafeCSS).
const HOST_SELECTOR: Record<DialogHost, CSSResult> = {
  "wa-dialog": css`wa-dialog`,
  "esphome-base-dialog": css`esphome-base-dialog`,
};

/** Consistent, tighter horizontal body gutter on the mobile sheet. Each dialog
 *  hardcodes its own desktop body padding (--wa-space-l … --wa-space-xl) with no
 *  mobile reduction, so the phone sheet looked inconsistent — some roomy, some
 *  not. ``!important`` is needed because consumers set ``::part(body)`` padding
 *  after this fragment in their styles array; only the inline (horizontal)
 *  padding is overridden so each dialog keeps its own vertical rhythm. */
const MOBILE_DIALOG_BODY_GUTTER = css`
  padding-inline: var(--wa-space-m) !important;
`;

/** Full-screen sheet on mobile. Pass a custom `breakpoint` for dialogs whose
 *  layout needs to go full-screen earlier than the shared phone cutoff (e.g.
 *  the settings dialog, whose stacked-nav band would otherwise float as an
 *  awkward centered box between the phone cutoff and its own stack point). */
export function fullscreenMobileDialog(
  host: DialogHost,
  breakpoint: number = MOBILE_BREAKPOINT
): CSSResult {
  const sel = HOST_SELECTOR[host];
  return css`
    @media (max-width: ${breakpoint}px) {
      ${sel}::part(dialog) {
        position: fixed;
        inset: 0;
        width: 100vw;
        height: 100vh;
        height: 100dvh;
        max-width: none;
        max-height: none;
        margin: 0;
        border-radius: 0;
      }
      ${sel}::part(body) {
        ${MOBILE_DIALOG_BODY_GUTTER}
      }
    }
  `;
}

/** Centered (native `margin: auto`) but capped to the viewport so tall
 *  content scrolls inside instead of overflowing. */
export function centeredMobileDialog(host: DialogHost): CSSResult {
  const sel = HOST_SELECTOR[host];
  return css`
    @media (max-width: ${MOBILE_BREAKPOINT}px) {
      ${sel}::part(dialog) {
        max-width: calc(100vw - var(--wa-space-l));
        /* vh fallback, then dvh */
        max-height: calc(100vh - var(--wa-space-l));
        max-height: calc(100dvh - var(--wa-space-l));
      }
      ${sel}::part(body) {
        ${MOBILE_DIALOG_BODY_GUTTER}
      }
    }
  `;
}
