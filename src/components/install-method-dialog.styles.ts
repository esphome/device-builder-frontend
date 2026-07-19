import { css } from "lit";

/**
 * Styles for <esphome-install-method-dialog>. Extracted from the
 * component file to keep it under the repo's file-size cap (see
 * README → "Code structure policies"). The dialog pulls these in
 * via its ``static styles`` array alongside ``espHomeStyles`` and
 * ``inputStyles``. Class names map to the install-method list, the
 * "Advanced options" disclosure, the OTA address-override card,
 * and the serial port-select view.
 */
export const installMethodDialogStyles = css`
  esphome-base-dialog {
    --width: 460px;
  }

  /* Primary header bar comes from primaryDialogHeaderStyles (shared). */

  /* Close-button styling is bundled in
     <esphome-base-dialog> via dialogCloseButtonStyles,
     no per-dialog override needed. */

  esphome-base-dialog::part(body) {
    padding: var(--wa-space-l);
  }

  esphome-base-dialog::part(footer) {
    display: none;
  }

  .method-notice {
    margin-bottom: var(--wa-space-m);
    font-size: var(--wa-font-size-s);
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-s);
  }

  .option {
    display: flex;
    align-items: center;
    gap: var(--wa-space-m);
    padding: var(--wa-space-m);
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    border-radius: var(--wa-border-radius-l);
    cursor: pointer;
    transition:
      background 0.12s,
      border-color 0.12s;
  }

  .option:hover:not(.option--disabled) {
    background: var(--esphome-tint);
    border-color: var(--esphome-primary);
  }

  .option--disabled {
    cursor: not-allowed;
  }

  .option--disabled > wa-icon,
  .option--disabled .info {
    opacity: 0.45;
  }

  .option wa-icon {
    font-size: 28px;
    color: var(--esphome-primary);
    flex-shrink: 0;
  }

  .option--disabled > wa-icon {
    color: var(--wa-color-text-quiet);
  }

  /* "Advanced options" disclosure (shared renderDisclosure helper) rendered
     below the method list. Separate it from the method cards above; the panel
     content stacks the OTA address form and the manual-download option with the
     same gap as the main list so the visual rhythm stays uniform when expanded. */
  .disclosure-toggle {
    margin-top: var(--wa-space-m);
  }

  .advanced-panel-content {
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-s);
  }

  /* Trailing chevron on option cards. chevron-right on
     direct-action rows (e.g. "Download firmware binary")
     signals "click to proceed"; chevron-down on the IP /
     hostname row signals an expandable card whose form opens
     inline inside the same card. */
  .option-chevron {
    margin-left: auto;
    font-size: 20px;
    color: var(--wa-color-text-quiet);
    flex-shrink: 0;
    transition: color 0.12s;
  }

  .option:hover .option-chevron,
  .option-collapsible:hover .option-chevron {
    color: var(--esphome-primary);
  }

  /* Expandable option card. The header row reuses the same
     icon + title/desc layout as a plain .option; clicking it
     (or any part of the card) toggles an inline body below
     that holds the OTA address form, so the configuration
     lives INSIDE the card rather than as a separate panel. */
  .option-collapsible {
    display: flex;
    flex-direction: column;
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    border-radius: var(--wa-border-radius-l);
    overflow: hidden;
    transition:
      border-color 0.12s,
      background 0.12s;
  }

  .option-collapsible:hover {
    border-color: var(--esphome-primary);
    background: var(--esphome-tint);
  }

  .option-collapsible__header {
    display: flex;
    align-items: center;
    gap: var(--wa-space-m);
    padding: var(--wa-space-m);
    background: transparent;
    border: none;
    cursor: pointer;
    width: 100%;
    font-family: inherit;
    color: inherit;
    text-align: left;
  }

  .option-collapsible__header:focus-visible {
    outline: var(--esphome-focus-outline);
    outline-offset: -2px;
  }

  .option-collapsible__header wa-icon:first-child {
    font-size: 28px;
    color: var(--esphome-primary);
    flex-shrink: 0;
  }

  .option-collapsible__body {
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-s);
    padding: 0 var(--wa-space-m) var(--wa-space-m);
  }

  .ota-form-input {
    width: 100%;
    box-sizing: border-box;
  }

  .ota-form-actions {
    display: flex;
    gap: var(--wa-space-s);
    justify-content: flex-end;
  }

  .ota-form-actions .btn {
    padding: 6px 14px;
    border-radius: var(--wa-border-radius-m);
    font-size: var(--wa-font-size-xs);
    font-weight: var(--wa-font-weight-bold);
    font-family: inherit;
    cursor: pointer;
    border: none;
    transition: background 0.12s;
  }

  .ota-form-actions .btn--primary {
    background: var(--esphome-primary);
    color: var(--esphome-on-primary);
  }

  .ota-form-actions .btn--primary:hover:not(:disabled) {
    background: var(--esphome-primary-hover);
  }

  .ota-form-actions .btn--primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .title {
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-bold);
    color: var(--wa-color-text-normal);
  }

  /* Inline link inside an option's title (used by the web.esphome.io
     row to render the host name as a clickable link). stopPropagation
     on the link's click handler keeps the row's "start install" from
     firing when the user just wants to preview the destination. */
  .title .inline-link {
    color: var(--esphome-primary);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .title .inline-link:hover,
  .title .inline-link:focus-visible {
    text-decoration-thickness: 2px;
    outline: none;
  }

  .desc {
    font-size: var(--wa-font-size-2xs);
    color: var(--wa-color-text-quiet);
    line-height: 1.4;
  }

  .back-btn {
    margin-bottom: var(--wa-space-s);
  }

  .loading {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--wa-space-s);
    padding: var(--wa-space-xl) 0;
    color: var(--wa-color-text-quiet);
    font-size: var(--wa-font-size-s);
  }
`;
