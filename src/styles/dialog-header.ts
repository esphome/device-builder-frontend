/**
 * Shared primary-colour dialog header.
 *
 * The settings, logs, install-method, and firmware-jobs dialogs all dress their
 * title bar the same way: a full-bleed `--esphome-primary` band, 40px tall, with
 * the title in `--esphome-on-primary`. The block was copy-pasted per dialog and
 * two copies set the right padding wrong (`0 var(--wa-space-m)` instead of
 * `0 0 0 var(--wa-space-m)`), which pushed the close button in from the corner.
 * Defining it once here keeps the bar identical and keeps the 40x40 close button
 * (from `dialogCloseButtonStyles`) flush in the corner. #39
 *
 * Dual selectors so the one fragment covers both the raw `<wa-dialog>` dialogs
 * and the ones migrated onto `<esphome-base-dialog>` (parts re-exported by name).
 * Dialogs with their own title type (logs is monospace) layer that on top.
 */
import { css } from "lit";

export const primaryDialogHeaderStyles = css`
  wa-dialog::part(header),
  esphome-base-dialog::part(header) {
    background: var(--esphome-primary);
    /* Right padding 0 so the 40x40 close button sits flush with the corner. */
    padding: 0 0 0 var(--wa-space-m);
    height: 40px;
    box-sizing: border-box;
  }

  wa-dialog::part(title),
  esphome-base-dialog::part(title) {
    color: var(--esphome-on-primary);
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-bold);
  }

  /* The band height is fixed, so a wrapped title would clip against it;
     keep these titles single-line (base-dialog wraps by default). */
  esphome-base-dialog::part(title-text) {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
`;
