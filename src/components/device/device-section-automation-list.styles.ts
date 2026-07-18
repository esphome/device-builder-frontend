import { css } from "lit";

/** Styles for ``<esphome-section-automation-list>``. Moved verbatim from
 *  ``device-section-config.styles.ts`` (the old ``.api-actions-*`` block)
 *  when the three inline manage-lists were unified into one component. */
export const deviceSectionAutomationListStyles = css`
  /* Manage-list block (Automations / API actions / component actions).
     Inline title + "Add X" button on row 1, then either the rows or an
     empty placeholder below — the breathing room between those two reads
     as the visual divider, so the gap is deliberately bigger than the
     row-to-row spacing inside the list. */
  .list {
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-m);
    padding-top: var(--wa-space-s);
    border-top: 1px solid var(--wa-color-surface-border);
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--wa-space-s);
  }

  .title {
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-semibold);
    margin: 0;
    color: var(--wa-color-text-normal);
  }

  .add {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    background: var(--wa-color-brand-fill-loud, var(--esphome-primary));
    color: var(--wa-color-brand-on-loud, var(--esphome-on-primary));
    border: var(--wa-border-width-s) solid
      var(--wa-color-brand-fill-loud, var(--esphome-primary));
    padding: 2px var(--wa-space-s);
    border-radius: var(--wa-border-radius-m);
    cursor: pointer;
    font-size: var(--wa-font-size-xs);
    font-weight: var(--wa-font-weight-semibold);
    font-family: inherit;
    transition:
      background 0.12s,
      border-color 0.12s;
  }

  .add:hover {
    background: color-mix(
      in srgb,
      var(--wa-color-brand-fill-loud, var(--esphome-primary)),
      black 10%
    );
    border-color: color-mix(
      in srgb,
      var(--wa-color-brand-fill-loud, var(--esphome-primary)),
      black 10%
    );
  }

  .add wa-icon {
    font-size: 14px;
  }

  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    border: 1px solid var(--wa-color-surface-border);
    border-radius: var(--wa-border-radius-m);
    overflow: hidden;
    background: var(--wa-color-surface-raised, transparent);
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--wa-space-s);
    padding: var(--wa-space-xs) var(--wa-space-s);
    border-top: 1px solid var(--wa-color-surface-border);
    background: transparent;
    transition: background 0.12s;
  }

  .row:first-child {
    border-top: none;
  }

  .row:hover {
    background: var(--wa-color-surface-lowered);
  }

  .name {
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: var(--wa-font-size-s);
    color: var(--wa-color-text-normal);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row-buttons {
    display: inline-flex;
    align-items: center;
    gap: var(--wa-space-2xs);
  }

  .row-edit,
  .row-delete {
    appearance: none;
    border: 1px solid transparent;
    background: transparent;
    color: var(--wa-color-text-quiet);
    width: 26px;
    height: 26px;
    border-radius: 6px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .row-edit:hover:not(:disabled) {
    background: var(--wa-color-surface-default);
    color: var(--wa-color-text-normal);
  }

  .row-delete:hover:not(:disabled) {
    background: color-mix(in srgb, var(--esphome-error), transparent 90%);
    color: var(--esphome-error);
  }

  .row-edit:disabled,
  .row-delete:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
`;
