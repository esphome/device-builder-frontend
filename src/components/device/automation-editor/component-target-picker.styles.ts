import { css } from "lit";

/**
 * Styles for <esphome-component-target-picker>: a grouped radiogroup of
 * configured component instances (a multi-entity platform is a header, its
 * sub-entities the rows), mirroring the catalog by-target picker and the
 * nested-form domain badge.
 */
export const componentTargetPickerStyles = css`
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-2xs);
    margin-bottom: var(--wa-space-m);
  }
  .field-label {
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-semibold);
    color: var(--wa-color-text-normal);
  }
  .error {
    color: var(--esphome-error, #d92d20);
    font-size: var(--wa-font-size-2xs);
    margin-top: var(--wa-space-2xs);
  }
  .component-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 280px;
    overflow-y: auto;
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    border-radius: var(--wa-border-radius-m);
    padding: var(--wa-space-2xs);
  }
  /* The role=group wrapper carries the same column gap as the list, with a
     left rule + indented rows so a group's members read as nested under its
     header and a following loose row (e.g. wifi) is clearly outside it. */
  .component-group-wrap {
    display: flex;
    flex-direction: column;
    gap: 2px;
    border-left: 2px solid var(--wa-color-surface-border);
    margin-left: var(--wa-space-2xs);
    padding-left: var(--wa-space-2xs);
  }
  .component-group-wrap .component-choice {
    padding-left: var(--wa-space-m);
  }
  .component-group {
    font-size: var(--wa-font-size-2xs);
    font-weight: var(--wa-font-weight-semibold);
    color: var(--wa-color-text-quiet);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin: var(--wa-space-s) var(--wa-space-2xs) var(--wa-space-2xs);
  }
  /* Trim the leading gap only when a group is the very first row (each
     group now sits in its own wrap, so :first-child on the header would
     match every group). */
  .component-group-wrap:first-child .component-group {
    margin-top: var(--wa-space-2xs);
  }
  .component-group-id {
    text-transform: none;
    letter-spacing: normal;
    font-weight: var(--wa-font-weight-normal);
  }
  .component-choice {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--wa-space-s);
    padding: var(--wa-space-xs) var(--wa-space-s);
    border-radius: var(--wa-border-radius-m);
    cursor: pointer;
    transition: background 0.12s;
  }
  .component-choice:hover,
  .component-choice:focus-visible {
    background: var(--wa-color-surface-lowered);
    outline: none;
  }
  .component-choice--selected {
    background: color-mix(
      in srgb,
      var(--esphome-primary) 14%,
      var(--wa-color-surface-default)
    );
  }
  .component-choice[aria-disabled="true"] {
    opacity: 0.55;
    cursor: default;
    pointer-events: none;
  }
  .component-choice-name {
    font-size: var(--wa-font-size-s);
    color: var(--wa-color-text-normal);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .component-domain {
    flex: 0 0 auto;
    font-size: var(--wa-font-size-2xs);
    color: var(--wa-color-text-quiet);
    background: var(--wa-color-surface-default);
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    border-radius: var(--wa-border-radius-s);
    padding: 1px 6px;
  }
`;
