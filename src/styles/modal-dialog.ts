/**
 * Shared `wa-dialog` skeleton styles for the app's modal-dialog
 * components (`<esphome-confirm-dialog>`,
 * `<esphome-yaml-validation-dialog>`, ...).
 *
 * These are the rules every modal in the app needs identically:
 *
 * - `wa-dialog::part(header) / part(title) / part(body) / part(footer)`
 *   — header padding + height, title typography, body padding,
 *   hidden footer slot. The footer is intentionally hidden because
 *   we render our own button rows inline as `.actions` for layout
 *   control (button order, wrap behaviour) that the wa-dialog
 *   footer slot doesn't expose.
 * - `.body` — the icon + text two-column layout used by every
 *   confirm-style modal.
 * - `.icon-wrap` — 40px circle that frames the leading icon.
 *   Colour is left to the consumer (variant-specific) so a
 *   destructive prompt can tint red while a primary one tints
 *   blue without forking this fragment.
 * - `.text` / `.actions` — the remaining body and action-row
 *   layout primitives.
 * - `.btn` / `.btn--cancel` — the base button shape and the
 *   cancel variant (every modal has one). Other button variants
 *   (`.btn--confirm`, `.btn--save-anyway`, ...) stay in the
 *   consumer's local styles since their colour intent is
 *   per-modal.
 *
 * Composition pattern:
 *
 * ```ts
 * static styles = [
 *   espHomeStyles,
 *   modalDialogStyles,
 *   dialogCloseButtonStyles,  // 40x40 close-button hit target
 *   css`
 *     wa-dialog { --width: 420px; }     // per-modal width
 *     .icon-wrap { ... }                // per-modal icon colour
 *     .btn--confirm { ... }             // per-modal action buttons
 *   `,
 * ];
 * ```
 *
 * Don't drop the `--width` here — pulling it out of consumers
 * would force one width across every dialog (the existing
 * spread is 420 / 460 / 480 depending on copy length).
 */
import { css } from "lit";

export const modalDialogStyles = css`
  wa-dialog::part(header) {
    padding: var(--wa-space-l) var(--wa-space-l) var(--wa-space-s);
  }

  wa-dialog::part(title) {
    font-size: var(--wa-font-size-m);
    font-weight: var(--wa-font-weight-bold);
    color: var(--wa-color-text-normal);
  }

  wa-dialog::part(body) {
    padding: 0 var(--wa-space-l);
  }

  wa-dialog::part(footer) {
    display: none;
  }

  .body {
    display: flex;
    align-items: flex-start;
    gap: var(--wa-space-m);
    padding-bottom: var(--wa-space-m);
  }

  .icon-wrap {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .icon-wrap wa-icon {
    font-size: 22px;
  }

  .text {
    flex: 1;
    min-width: 0;
    font-size: var(--wa-font-size-s);
    color: var(--wa-color-text-quiet);
    line-height: 1.5;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--wa-space-s);
    flex-wrap: wrap;
    padding: var(--wa-space-m) 0 var(--wa-space-l);
  }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 18px;
    border-radius: var(--wa-border-radius-m);
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-bold);
    font-family: inherit;
    cursor: pointer;
    border: none;
    transition: background 0.12s;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn--cancel {
    background: var(--wa-color-surface-lowered);
    color: var(--wa-color-text-normal);
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
  }

  .btn--cancel:hover {
    background: var(--wa-color-surface-border);
  }
`;
