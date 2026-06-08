import { css } from "lit";

/**
 * Styles for <esphome-navigator-search>. Kept in its own file to mirror
 * the navigator's split layout (see device-navigator.styles.ts).
 */
export const navigatorSearchStyles = css`
  :host {
    display: block;
  }

  .search {
    display: flex;
    align-items: center;
    gap: var(--wa-space-xs);
    margin: var(--wa-space-s) var(--wa-space-s) var(--wa-space-2xs);
    padding: 0 var(--wa-space-s);
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    border-radius: var(--wa-border-radius-m);
    background: var(--wa-color-surface-default);
  }

  .search:focus-within {
    border-color: var(--esphome-primary);
  }

  .search-icon {
    font-size: var(--wa-font-size-l);
    color: var(--wa-color-text-quiet);
    flex-shrink: 0;
  }

  input {
    flex: 1;
    min-width: 0;
    border: none;
    background: transparent;
    color: var(--wa-color-text-normal);
    /* 16px floor avoids iOS focus-zoom in the mobile drawer. */
    font-size: max(16px, var(--wa-font-size-s));
    font-family: inherit;
    padding: var(--wa-space-s) 0;
    outline: none;
  }

  /* The native clear affordance duplicates our own ✕ button. */
  input::-webkit-search-cancel-button {
    display: none;
  }

  .search-clear {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: transparent;
    color: var(--wa-color-text-quiet);
    cursor: pointer;
    padding: 2px;
    border-radius: var(--wa-border-radius-s);
    flex-shrink: 0;
  }

  .search-clear:hover {
    color: var(--wa-color-text-normal);
  }

  .search-clear wa-icon {
    display: block;
    font-size: var(--wa-font-size-m);
  }

  .search-result {
    margin: var(--wa-space-2xs) var(--wa-space-s) var(--wa-space-xs);
    font-size: var(--wa-font-size-2xs);
    color: var(--wa-color-text-quiet);
  }
`;
