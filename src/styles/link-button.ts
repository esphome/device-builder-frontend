import { css } from "lit";

/**
 * Inline link-styled button (also safe on an ``<a>``): strips the native
 * button chrome and renders as an underlined primary-colored inline link.
 * Hover / focus affordances and extras (font-weight, underline offset,
 * color overrides) stay per site, layered on the site's own class.
 */
export const linkButtonStyles = css`
  .link-button {
    border: none;
    background: none;
    padding: 0;
    font: inherit;
    color: var(--esphome-primary);
    cursor: pointer;
    text-decoration: underline;
  }
`;
