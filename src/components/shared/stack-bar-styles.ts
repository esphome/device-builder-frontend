import { css } from "lit";

/**
 * The dashboard accordion's section bars — one source for the remote panel's
 * banner and the Device builder header so they stay pixel-identical.
 *
 * Square edge-to-edge strips (top/bottom borders only) that read as an
 * extension of the app header: the horizontal padding is the header's
 * content gutter, and the leading icon / trailing chevron sit in boxes
 * sized from the header footprint tokens (logo box / action box) so
 * their centers line up with the header logo and kebab above at every
 * breakpoint.
 * ``--stack-gap`` is the one vertical rhythm token between a bar and its
 * section content (both sides, so top and bottom spacing match).
 */
export const stackBarStyles = css`
  :host {
    --stack-gap: var(--wa-space-m);
    /* The header's logo / kebab footprints (shared tokens from
       espHomeStyles), so icon and chevron centers line up with the
       header at every breakpoint. */
    --stack-bar-icon-box: var(--esphome-header-logo-box, 32px);
    --stack-bar-chevron-box: var(--esphome-header-action-box, 37px);
    --stack-bar-icon-size: 20px;
    --stack-bar-title-size: var(--wa-font-size-s);
    --stack-bar-subtitle-size: var(--wa-font-size-xs);
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
  }

  /* Negative offset keeps the ring inside the full-bleed bar; a real
     outline lets forced-colors mode substitute the system highlight. */
  .stack-bar:focus-visible {
    outline: 2px solid var(--esphome-primary);
    outline-offset: -2px;
  }

  .stack-bar > wa-icon:first-child {
    width: var(--stack-bar-icon-box);
    display: inline-flex;
    justify-content: center;
    font-size: var(--stack-bar-icon-size);
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
    font-size: var(--stack-bar-title-size);
    font-weight: var(--wa-font-weight-bold);
    color: var(--wa-color-text-normal);
  }

  /* Quiet inline tagline after the title ("builds firmware for other
     dashboards"). Hidden on phones — it wraps under the title there and
     doubles each bar's height; the titles carry the meaning alone. The
     870px cutoff matches the header's compact breakpoint the bars align
     to (--esphome-header-logo-box). */
  .stack-bar-subtitle {
    font-size: var(--stack-bar-subtitle-size);
    color: var(--wa-color-text-quiet);
  }

  @media (max-width: 870px) {
    .stack-bar-subtitle {
      display: none;
    }
  }

  .stack-bar-chevron {
    margin-left: auto;
    width: var(--stack-bar-chevron-box);
    display: inline-flex;
    justify-content: center;
    font-size: var(--stack-bar-icon-size);
    color: var(--wa-color-text-quiet);
    transition: transform 0.15s;
    flex-shrink: 0;
  }

  .stack-bar[aria-expanded="true"] .stack-bar-chevron {
    transform: rotate(180deg);
  }
`;
