import { css } from "lit";

export const addComponentDialogStyles = css`
  esphome-base-dialog {
    --width: 900px;
  }

  esphome-base-dialog.form-view {
    --width: 480px;
  }

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

  esphome-base-dialog::part(body) {
    padding: var(--wa-space-l);
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

  /* Breadcrumb that shows up while the user is detoured into
     "add a dependency" mid-way through adding another component.
     Tells them we'll bring them back to the original after. */
  .return-banner {
    display: flex;
    align-items: center;
    gap: var(--wa-space-2xs);
    margin-bottom: var(--wa-space-m);
    padding: var(--wa-space-2xs) var(--wa-space-s);
    background: var(--esphome-tint);
    border-left: 3px solid var(--esphome-primary);
    border-radius: var(--wa-border-radius-s);
    font-size: var(--wa-font-size-xs);
    color: var(--wa-color-text-quiet);
  }

  .return-banner strong {
    color: var(--wa-color-text-normal);
    font-weight: var(--wa-font-weight-semibold);
  }

  .bundle-banner {
    display: flex;
    align-items: center;
    gap: var(--wa-space-xs);
    margin-bottom: var(--wa-space-m);
    padding: var(--wa-space-xs) var(--wa-space-s);
    background: var(--esphome-tint);
    border-left: 3px solid var(--esphome-primary);
    border-radius: var(--wa-border-radius-s);
    font-size: var(--wa-font-size-xs);
    color: var(--wa-color-text-normal);
  }

  .bundle-banner wa-icon {
    font-size: 14px;
    color: var(--esphome-primary);
  }

  /* Surfaces a hydrate / WS-transport failure on the catalog
     view; the form's own banner is unreachable when _selected
     is still null. */
  .catalog-error {
    margin-bottom: var(--wa-space-m);
    padding: var(--wa-space-xs) var(--wa-space-s);
    background: color-mix(in srgb, var(--wa-color-danger-60), transparent 88%);
    border-left: 3px solid var(--wa-color-danger-60);
    border-radius: var(--wa-border-radius-s);
    font-size: var(--wa-font-size-s);
    color: var(--wa-color-text-normal);
  }
`;
