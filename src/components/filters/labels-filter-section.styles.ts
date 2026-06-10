/**
 * Styles for <esphome-labels-filter-section>: the catalog rows with
 * their per-row edit/delete actions and the create-label CTA.
 */
import { css } from "lit";

export const labelsFilterSectionStyles = css`
  /* Each catalog row is a button + per-row actions. The
     actions sit absolutely on the right so they overlap the
     count badge at rest and reveal smoothly on hover. */
  .row-wrap {
    position: relative;
  }

  .row-wrap .facet-row-count {
    transition: opacity 0.12s ease;
  }

  /* Reveal triggers: mouse hover, or a descendant element that
     has visible (keyboard) focus. :focus-within would also
     match the row button right after a click — clicks leave
     focus on the button, so the actions would stay pinned
     visible after any selection toggle. :has(:focus-visible)
     scopes the reveal to actual keyboard navigation so a mouse
     click on a row doesn't latch the icons on. */
  .row-wrap:hover .facet-row-count,
  .row-wrap:has(:focus-visible) .facet-row-count {
    opacity: 0;
  }

  .row-actions {
    position: absolute;
    top: 50%;
    right: 6px;
    transform: translateY(-50%) translateX(4px);
    display: flex;
    align-items: center;
    gap: 2px;
    opacity: 0;
    pointer-events: none;
    transition:
      opacity 0.15s ease,
      transform 0.15s ease;
  }

  .row-wrap:hover .row-actions,
  .row-wrap:has(:focus-visible) .row-actions {
    opacity: 1;
    pointer-events: auto;
    transform: translateY(-50%) translateX(0);
  }

  /* Touch viewports get the actions pinned visible — there's
     no hover to reveal them and a tap fires the row's
     selection toggle before focus-within can settle. The
     count badge has to hide unconditionally on those
     viewports so the two don't stack on top of each other. */
  @media (hover: none) {
    .row-wrap .facet-row-count {
      opacity: 0;
    }
    .row-actions {
      opacity: 1;
      pointer-events: auto;
      transform: translateY(-50%) translateX(0);
    }
  }

  .row-action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: var(--wa-border-radius-m);
    border: var(--wa-border-width-s) solid transparent;
    background: var(--wa-color-surface-default);
    color: var(--wa-color-text-quiet);
    cursor: pointer;
    padding: 0;
    transition:
      background-color 0.12s,
      border-color 0.12s,
      color 0.12s;
  }

  .row-action:hover {
    background: var(--wa-color-surface-raised);
    border-color: var(--wa-color-surface-border);
    color: var(--wa-color-text-normal);
  }

  .row-action:focus-visible {
    outline: none;
    color: var(--wa-color-text-normal);
    box-shadow: var(--esphome-focus-ring-tight);
  }

  .row-action--danger:hover {
    background: color-mix(in srgb, var(--wa-color-danger-fill-loud), transparent 88%);
    border-color: color-mix(in srgb, var(--wa-color-danger-fill-loud), transparent 70%);
    color: var(--wa-color-danger-fill-loud);
  }

  .row-action--danger:focus-visible {
    box-shadow: 0 0 0 2px
      color-mix(in srgb, var(--wa-color-danger-fill-loud), transparent 70%);
  }

  .row-action wa-icon {
    font-size: 14px;
  }

  /* Create-label CTA. Sits below the catalog list (or fills the
     section when the catalog is empty), visually separated from
     the rows by a divider. Primary-tinted rather than filled so it
     reads as a call-to-action without shouting. */
  .create-section {
    border-top: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    padding: var(--wa-space-2xs);
    flex-shrink: 0;
  }

  .create-section--empty {
    border-top: none;
  }

  .create-trigger {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    width: 100%;
    padding: 8px 12px;
    border: var(--wa-border-width-s) solid
      color-mix(in srgb, var(--esphome-primary), transparent 70%);
    border-radius: var(--wa-border-radius-m);
    background: var(--esphome-tint);
    color: var(--esphome-primary);
    font-family: inherit;
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-semibold, 600);
    cursor: pointer;
    transition:
      background-color 0.12s,
      border-color 0.12s;
  }

  .create-trigger:hover {
    background: var(--esphome-tint-strong);
    border-color: var(--esphome-tint-border-strong);
  }

  .create-trigger:focus-visible {
    outline: none;
    box-shadow: var(--esphome-focus-ring-tight);
  }

  .create-trigger wa-icon {
    font-size: 16px;
  }
`;
