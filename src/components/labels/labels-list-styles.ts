import { css } from "lit";

/**
 * Shared scrollable label-list chrome for the in-dialog label
 * pickers.
 *
 * Both `<esphome-device-labels-editor>` (single device, binary
 * toggle) and `<esphome-bulk-labels-dialog>` (multi device,
 * tri-state) render the same shape: a vertical list of label rows
 * where each row is a `role="checkbox"` button with a colored
 * check indicator + the label's chip.
 *
 * Classes provided:
 *
 *   .options                 — vertically-scrollable list container
 *                              (overflow + bleed-into-l-padding).
 *                              The consumer caps height locally — the
 *                              single-device editor pins ``320px``;
 *                              the bulk dialog uses ``60vh`` so it
 *                              fits short mobile viewports.
 *   .option                  — button row (≥ 44 px tap target, focus
 *                              ring on focus-visible)
 *   .option-check            — 20 × 20 colored square holding the
 *                              check icon
 *   .option-check--checked   — fully-checked variant (primary fill)
 *   .option-check--mixed     — indeterminate variant (faded primary
 *                              fill; only the tri-state caller uses
 *                              this — the single-device caller never
 *                              applies the class)
 *   .option-empty            — centred placeholder for the
 *                              empty-catalog state
 *
 * Consumers compose with their own `wa-dialog` part rules and
 * footer/header layout — this fragment is only the inner list.
 */
export const labelsListStyles = css`
  .options {
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow-y: auto;
    margin: 0 calc(var(--wa-space-l) * -1);
    padding: 0 var(--wa-space-l);
  }

  .option {
    display: flex;
    align-items: center;
    gap: 12px;
    /* ≥ 44 px tap target on every row (WCAG / iOS HIG). */
    min-height: 44px;
    padding: 8px 10px;
    border-radius: var(--wa-border-radius-m);
    cursor: pointer;
    background: transparent;
    border: none;
    text-align: left;
    font-family: inherit;
    color: inherit;
    transition: background-color 0.12s;
  }

  .option:hover {
    background: var(--wa-color-surface-lowered);
  }

  .option:focus-visible {
    outline: none;
    background: var(--wa-color-surface-lowered);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--esphome-primary), transparent 70%);
  }

  .option-check {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: 5px;
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    flex-shrink: 0;
    color: var(--esphome-on-primary);
    background: var(--wa-color-surface-default);
  }

  .option-check--checked,
  .option-check--mixed {
    background: var(--esphome-primary);
    border-color: var(--esphome-primary);
  }

  /* The mixed (tri-state indeterminate) variant uses the same fill
     as checked but at reduced opacity, mirroring the platform-native
     indeterminate-checkbox affordance on macOS / Windows. Only the
     bulk-labels picker applies this class; the single-device editor
     never sets it. */
  .option-check--mixed {
    background: color-mix(in srgb, var(--esphome-primary), transparent 30%);
  }

  .option-check wa-icon {
    font-size: 14px;
  }

  .option-empty {
    text-align: center;
    font-size: var(--wa-font-size-xs);
    color: var(--wa-color-text-quiet);
    padding: var(--wa-space-m);
  }
`;
