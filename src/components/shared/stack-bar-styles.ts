import { css } from "lit";

/**
 * The dashboard accordion's section bars — one source for the remote panel's
 * banner and the Device builder header so they stay pixel-identical.
 *
 * Square edge-to-edge strips (top/bottom borders only) that read as an
 * extension of the app header: the horizontal padding is the header's
 * content gutter, and the leading icon / trailing chevron sit in 32px boxes
 * so their centers line up with the header logo and kebab above.
 * ``--stack-gap`` is the one vertical rhythm token between a bar and its
 * section content (both sides, so top and bottom spacing match).
 */
export const stackBarStyles = css`
  :host {
    --stack-gap: var(--wa-space-m);
    --stack-bar-icon-box: 32px;
  }

  .stack-bar {
    display: flex;
    align-items: center;
    width: 100%;
    box-sizing: border-box;
    gap: var(--wa-space-s);
    padding: var(--wa-space-xs) var(--content-gutter, var(--wa-space-l));
    margin: 0;
    border: none;
    border-top: var(--wa-border-width-s) solid var(--esphome-primary);
    border-bottom: var(--wa-border-width-s) solid var(--esphome-primary);
    border-radius: 0;
    background: transparent;
    font-family: inherit;
    text-align: left;
    cursor: pointer;
    transition: background 0.1s;
  }

  .stack-bar:hover,
  .stack-bar:focus-visible {
    background: var(--esphome-primary-light);
    outline: none;
  }

  .stack-bar > wa-icon:first-child {
    width: var(--stack-bar-icon-box);
    display: inline-flex;
    justify-content: center;
    font-size: 20px;
    color: var(--esphome-primary);
    flex-shrink: 0;
  }

  /* Title (plus any pills/badges) wraps among itself; baseline-aligned so
     badge text sits on the title's baseline; the chevron stays pinned. */
  .stack-bar-main {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: var(--wa-space-xs) var(--wa-space-s);
    flex: 1;
    min-width: 0;
  }

  .stack-bar-title {
    font-size: var(--wa-font-size-m);
    font-weight: var(--wa-font-weight-bold);
    color: var(--wa-color-text-normal);
  }

  /* Quiet inline tagline after the title ("builds firmware for other
     dashboards"); wraps under the title on narrow viewports. */
  .stack-bar-subtitle {
    font-size: var(--wa-font-size-xs);
    color: var(--wa-color-text-quiet);
  }

  .stack-bar-chevron {
    margin-left: auto;
    width: var(--stack-bar-icon-box);
    display: inline-flex;
    justify-content: center;
    font-size: 20px;
    color: var(--wa-color-text-quiet);
    transition: transform 0.15s;
    flex-shrink: 0;
  }

  .stack-bar[aria-expanded="true"] .stack-bar-chevron {
    transform: rotate(180deg);
  }
`;
