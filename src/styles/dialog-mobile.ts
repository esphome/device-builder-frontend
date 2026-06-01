import { type CSSResult, css, unsafeCSS } from "lit";

/**
 * Shared mobile-layout fragments for app dialogs (issue #41).
 *
 * Every dialog renders through webawesome's `<wa-dialog>`, whose
 * native `<dialog>` centers on the viewport via `inset: 0; margin: auto`.
 * On phones two patterns are wanted:
 *
 * - {@link centeredMobileDialog}: short / form dialogs stay centered but
 *   get a dvh- and safe-area-aware height cap so tall content scrolls
 *   inside the box instead of overflowing the screen.
 * - {@link fullscreenMobileDialog}: content-heavy dialogs (build / log
 *   output, the create-config wizard, validate, install) fill the screen
 *   edge-to-edge.
 *
 * `::part()` only pierces a single shadow level, so the rule must live in
 * the stylesheet of whichever component hosts the `<wa-dialog>`. Pass the
 * matching host selector: `"wa-dialog"` from a component that renders
 * `<wa-dialog>` directly (raw dialogs, and `base-dialog` itself), or
 * `"esphome-base-dialog"` from a consumer of `<esphome-base-dialog>` (the
 * part is re-exposed via `exportparts`). The outer tree wins the parts
 * cascade, so a consumer's `esphome-base-dialog::part(dialog)` override
 * beats base-dialog's own default.
 *
 * Both fragments default to the same breakpoint so reflow points stay in
 * lockstep across dialogs; pass a custom one only where a dialog already
 * shipped with a different threshold (e.g. logs-dialog at 700px).
 */
const MOBILE_DIALOG_BREAKPOINT = "600px";

/** Full-screen sheet on mobile. Mirrors the pattern logs-dialog and the
 *  create-config wizard used inline before this was shared. */
export function fullscreenMobileDialog(
  hostSelector: string,
  breakpoint: string = MOBILE_DIALOG_BREAKPOINT
): CSSResult {
  const host = unsafeCSS(hostSelector);
  return css`
    @media (max-width: ${unsafeCSS(breakpoint)}) {
      ${host}::part(dialog) {
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

      /* Keep the last action / log line clear of the home indicator on
         notched phones (no-op where the inset is 0). */
      ${host}::part(body),
      ${host}::part(footer) {
        padding-bottom: max(var(--wa-space-l), env(safe-area-inset-bottom));
      }
    }
  `;
}

/** Stay vertically centered (wa-dialog's native `margin: auto`) but cap
 *  the box to the dynamic viewport minus safe areas so tall content
 *  scrolls internally instead of running off-screen. Does not touch
 *  `inset` / `margin`, so the native centering is preserved. */
export function centeredMobileDialog(
  hostSelector: string,
  breakpoint: string = MOBILE_DIALOG_BREAKPOINT
): CSSResult {
  const host = unsafeCSS(hostSelector);
  return css`
    @media (max-width: ${unsafeCSS(breakpoint)}) {
      ${host}::part(dialog) {
        max-width: calc(
          100vw - var(--wa-space-l) - env(safe-area-inset-left) - env(
              safe-area-inset-right
            )
        );
        max-height: calc(
          100dvh - var(--wa-space-l) - env(safe-area-inset-top) - env(
              safe-area-inset-bottom
            )
        );
      }
    }
  `;
}
