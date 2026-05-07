/**
 * Shared `wa-dialog` close-button styling.
 *
 * Pulled out of the per-dialog styles after PR #206 (issue #213's
 * sibling cleanup): the close-button block was duplicated verbatim
 * across 5+ dialogs and the only practical way to keep them in sync
 * was a shared `css` fragment. Drop this into a dialog's
 * `static styles = [..., dialogCloseButtonStyles, css\`...\`]` array
 * and the `wa-dialog::part(close-button__base)` selectors below pick
 * up the close button automatically.
 *
 * What the styles do, and why:
 *
 * - **40×40 hit target.** `wa-dialog`'s default close button is just
 *   the icon's intrinsic ~14px footprint, which is below WCAG's 24×24
 *   minimum and miserable to hit on touch / trackball. The size is a
 *   fixed 40 because that's also the header height every dialog in
 *   this app uses (`wa-dialog::part(header) { height: 40px }`); a
 *   square button reads as the natural cap on the title bar's right
 *   edge. There's no design token for header height, so 40 stays a
 *   literal here — if a future theme changes the header height, this
 *   constant moves with it.
 * - **Hover + focus background highlight.** Same `color-mix(...,
 *   --esphome-on-primary, transparent 85%)` tint mouse and keyboard
 *   users see — the tint is the primary feedback signal.
 * - **`:focus-visible` keeps a visible outline.** Earlier per-dialog
 *   copies set `outline: none` on focus, which removed the default
 *   focus ring and degraded keyboard / forced-colors-mode focus
 *   visibility. The new shape draws a 2px `currentColor` outline
 *   pulled inside the button (`outline-offset: -2px`) so the ring
 *   never overlaps the dialog's header chrome and forced-colors mode
 *   can substitute the system `Highlight` colour automatically. The
 *   outline + the background tint together give two redundant focus
 *   signals.
 */
import { css } from "lit";

export const dialogCloseButtonStyles = css`
  wa-dialog::part(close-button__base) {
    background: transparent;
    border: none;
    box-shadow: none;
    padding: 0;
    width: 40px;
    height: 40px;
    min-width: unset;
    min-height: unset;
    color: var(--esphome-on-primary);
    cursor: pointer;
  }

  wa-dialog::part(close-button__base):hover,
  wa-dialog::part(close-button__base):focus-visible {
    background: color-mix(in srgb, var(--esphome-on-primary), transparent 85%);
  }

  /* Keep a visible focus indicator — replaces the previous
     "outline: none" which removed the default focus ring entirely
     and hurt keyboard / forced-colors / high-contrast users. The
     "currentColor" outline lets forced-colors mode substitute the
     system "Highlight" colour automatically; "outline-offset: -2px"
     keeps the ring inside the 40x40 target so it doesn't spill onto
     the dialog header. */
  wa-dialog::part(close-button__base):focus-visible {
    outline: 2px solid currentColor;
    outline-offset: -2px;
  }
`;
