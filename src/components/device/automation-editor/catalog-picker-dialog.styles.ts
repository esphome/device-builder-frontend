import { css } from "lit";

/**
 * Styles for <esphome-catalog-picker-dialog>. Extracted from the component
 * file to keep it under the repo's file-size cap (see README → "Code
 * structure policies"). The component pulls these in via its
 * ``static styles`` array alongside the shared ``espHomeStyles``,
 * ``inputStyles``, ``textStyles`` and ``disclosureStyles``.
 */
export const catalogPickerDialogStyles = css`
  esphome-base-dialog {
    --width: 640px;
  }

  esphome-base-dialog::part(body) {
    padding: 0;
  }

  /* Search field — mirrors the dashboard's .search-wrap +
     .search-input pattern (absolute-positioned leading icon over
     a fully-chromed native <input> that inherits styling from
     inputStyles). Padding lives on the outer container so the
     input has breathing room from the dialog edges. */
  .picker-search {
    padding: var(--wa-space-l) var(--wa-space-l) var(--wa-space-s);
  }

  .picker-search-wrap {
    position: relative;
  }

  .picker-search-icon {
    position: absolute;
    left: 10px;
    top: 50%;
    transform: translateY(-50%);
    font-size: 18px;
    color: var(--wa-color-text-quiet);
    pointer-events: none;
    z-index: 1;
  }

  .picker-search-wrap .picker-search-input {
    padding-left: 36px;
  }

  .picker-tabs {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 4px;
    margin: 0 var(--wa-space-l) var(--wa-space-s);
    background: var(--wa-color-surface-lowered);
    border-radius: var(--wa-border-radius-m);
    color: var(--wa-color-text-quiet);
  }

  .picker-tab {
    appearance: none;
    border: none;
    background: transparent;
    color: inherit;
    padding: 4px var(--wa-space-m);
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-semibold);
    font-family: inherit;
    cursor: pointer;
    border-radius: calc(var(--wa-border-radius-m) - 2px);
    transition:
      background 0.12s,
      color 0.12s,
      box-shadow 0.12s;
  }

  .picker-tab:hover:not(.active) {
    color: var(--wa-color-text-normal);
  }

  .picker-tab.active {
    background: var(--wa-color-surface-raised);
    color: var(--wa-color-text-normal);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
  }

  .picker-body {
    height: min(60vh, 500px);
    min-height: 320px;
    overflow-y: auto;
    padding: 0 var(--wa-space-l) var(--wa-space-l);
  }

  .picker-group-label {
    font-size: var(--wa-font-size-2xs);
    font-weight: var(--wa-font-weight-semibold);
    color: var(--wa-color-text-quiet);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin: var(--wa-space-m) var(--wa-space-2xs) var(--wa-space-2xs);
  }

  .picker-group-label:first-child {
    margin-top: var(--wa-space-2xs);
  }

  .picker-body .disclosure-toggle {
    display: flex;
    width: 100%;
    margin: var(--wa-space-m) 0 var(--wa-space-2xs);
  }

  .picker-body .disclosure-toggle:first-child {
    margin-top: var(--wa-space-2xs);
  }

  .disclosure-toggle .picker-group-label {
    display: inline-flex;
    align-items: baseline;
    gap: var(--wa-space-2xs);
    margin: 0;
  }

  .picker-group-count {
    padding: 0 var(--wa-space-2xs);
    border-radius: var(--wa-border-radius-s);
    background: var(--wa-color-surface-lowered);
    font-weight: var(--wa-font-weight-normal);
    letter-spacing: normal;
    text-transform: none;
  }

  .picker-body .disclosure-panel {
    margin-top: 0;
  }

  .picker-row {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: var(--wa-space-m);
    padding: var(--wa-space-s) var(--wa-space-m);
    border-radius: var(--wa-border-radius-m);
    cursor: pointer;
    transition: background 0.12s;
  }

  .picker-row:hover,
  .picker-row:focus-visible {
    background: var(--wa-color-surface-lowered);
    outline: none;
  }

  .picker-row-body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .picker-row-title {
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-semibold);
    color: var(--wa-color-text-normal);
  }

  .picker-row-desc {
    font-size: var(--wa-font-size-2xs);
    color: var(--wa-color-text-quiet);
    line-height: 1.4;
  }

  .picker-row-add {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: transparent;
    color: var(--wa-color-text-quiet);
    flex: 0 0 auto;
    line-height: 0;
    transition:
      background 0.12s,
      color 0.12s;
  }

  .picker-row-add svg {
    display: block;
    width: 18px;
    height: 18px;
    fill: currentColor;
  }

  .picker-row:hover .picker-row-add,
  .picker-row:focus-visible .picker-row-add {
    background: var(--wa-color-brand-fill-loud, var(--esphome-primary));
    color: var(--wa-color-brand-on-loud, var(--esphome-on-primary));
  }

  .picker-empty {
    text-align: center;
    color: var(--wa-color-text-quiet);
    font-size: var(--wa-font-size-s);
    padding: var(--wa-space-xl) var(--wa-space-l);
    font-style: italic;
  }
`;
