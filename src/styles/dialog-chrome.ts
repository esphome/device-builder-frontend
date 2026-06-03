import { css } from "lit";

/**
 * Shared dialog header / close-button chrome (#549 follow-up).
 *
 * The app's dialogs had three style blocks copied verbatim across many
 * components. These fragments are the single source of truth; drop the
 * relevant one(s) into a dialog's ``static styles`` array (after
 * ``espHomeStyles``) and add only the per-dialog deltas — ``--width``, body
 * padding, banners — alongside.
 *
 * Dual ``wa-dialog`` + ``esphome-base-dialog`` selectors cover both the raw
 * dialogs and the ones migrated onto the shared wrapper (its parts are
 * re-exported under the same names).
 */

/**
 * Neutral modal header: standard header padding, title typography, hidden
 * footer. The canonical default dialog chrome — ``modalDialogStyles``
 * composes it, and the form / picker dialogs that don't need the confirm
 * body layout use it directly. Body padding is intentionally NOT here: it
 * varies per dialog (``0 var(--wa-space-l)`` vs a bottom-padded variant).
 */
export const dialogChromeStyles = css`
  wa-dialog::part(header),
  esphome-base-dialog::part(header) {
    padding: var(--wa-space-l) var(--wa-space-l) var(--wa-space-s);
  }

  wa-dialog::part(title),
  esphome-base-dialog::part(title) {
    font-size: var(--wa-font-size-m);
    font-weight: var(--wa-font-weight-bold);
    color: var(--wa-color-text-normal);
  }

  wa-dialog::part(footer),
  esphome-base-dialog::part(footer) {
    display: none;
  }
`;

/**
 * Quiet close (X): strip wa-dialog's default button chrome so the X reads as
 * a plain icon. Shared by the neutral form dialogs that want a flat close
 * button (the primary-header fragment below carries its own, sized variant).
 */
export const quietCloseButtonStyles = css`
  wa-dialog::part(close-button__base),
  esphome-base-dialog::part(close-button__base) {
    background: transparent;
    border: none;
    box-shadow: none;
  }
`;

/**
 * Branded "wizard" header: a compact primary-colored bar, a flush 40×40
 * close button, and a back button slotted into ``esphome-base-dialog``'s
 * ``header-prefix``. Shared by the create-config wizard and the add-component
 * dialog. (The process-terminal dialogs — command / firmware-install / logs —
 * have a similar bar but a monospace title and a terminal body, so they're
 * intentionally not folded in here; see #600.) The back button is a plain
 * ``<button class="back-button" slot="header-prefix">`` in the consumer's
 * own light DOM, so the ``.back-button`` rule styles it directly.
 */
export const primaryHeaderDialogStyles = css`
  esphome-base-dialog::part(header) {
    background: var(--esphome-primary);
    /* Right padding is 0 so the close button sits flush with the
       dialog's corner — the button is explicitly sized to a 40x40
       square below to give the X a comfortable hit target right
       where the user reaches for it. */
    padding: 0 0 0 var(--wa-space-m);
    height: 40px;
    box-sizing: border-box;
  }

  /* Title text lives in base-dialog's title-text span; colour/weight
     cascade in from the forwarded title part. */
  esphome-base-dialog::part(title) {
    color: var(--esphome-on-primary);
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-bold);
  }

  esphome-base-dialog::part(close-button__base) {
    background: transparent;
    border: none;
    box-shadow: none;
    /* Square 40x40 button matching the header height so the X has a
       comfortable click/tap target instead of just the icon's
       ~14px footprint. */
    padding: 0;
    width: 40px;
    height: 40px;
    min-width: unset;
    min-height: unset;
    color: var(--esphome-on-primary);
    cursor: pointer;
  }

  .back-button {
    display: inline-flex;
    align-items: center;
    border: none;
    background: none;
    padding: 2px;
    margin-right: var(--wa-space-2xs);
    color: var(--esphome-on-primary);
    cursor: pointer;
    border-radius: 4px;
    opacity: 0.85;
  }

  .back-button:hover {
    opacity: 1;
  }
`;
