import { css } from "lit";

/**
 * Styles for <esphome-labels-filter>. Extracted from the component
 * file to keep it under the repo's file-size cap (see README →
 * "Code structure policies"). The filter pulls these in via its
 * ``static styles`` array alongside ``espHomeStyles``,
 * ``facetStyles``, and ``labelChipStyles``. Class names map to the
 * facet pill trigger, the labels popover, the catalog rows with
 * their per-row edit/delete actions, and the inline create-label
 * dialog.
 */
export const labelsFilterStyles = css`
  :host {
    display: inline-block;
    position: relative;
  }

  /* Each catalog row is a button + per-row actions. The
     actions sit absolutely on the right so they overlap the
     count badge at rest and reveal smoothly on hover, keeping
     the visual rhythm aligned with the other facet pills. */
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

  /* Edit-mode header: small back arrow + label so the popover
     doesn't lose context when the catalog list is hidden. */
  .edit-header {
    display: flex;
    align-items: center;
    gap: var(--wa-space-xs);
    padding: 4px 6px 2px;
  }

  .edit-back {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: var(--wa-border-radius-s);
    border: none;
    background: transparent;
    color: var(--wa-color-text-quiet);
    cursor: pointer;
    padding: 0;
  }

  .edit-back:hover {
    background: var(--wa-color-surface-lowered);
    color: var(--wa-color-text-normal);
  }

  .edit-back wa-icon {
    font-size: 16px;
  }

  .edit-title {
    font-size: var(--wa-font-size-xs);
    font-weight: var(--wa-font-weight-bold);
    color: var(--wa-color-text-quiet);
  }

  /* Inline create-form section. Sits below the catalog list
     (or fills the popover when the catalog is empty) and is
     visually separated from the list by a divider so the user
     reads the rows + create form as distinct sections. */
  .create-section {
    border-top: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    padding: var(--wa-space-2xs);
    flex-shrink: 0;
  }

  .create-section--empty {
    border-top: none;
  }

  /* "Create new label" footer button — fills the create section
     and opens the standalone dialog. Reads as a primary call-to-
     action without committing to the loudness of a filled button:
     primary-tinted background, primary text, hover deepens. */
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
    background: color-mix(in srgb, var(--esphome-primary), transparent 92%);
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
    background: color-mix(in srgb, var(--esphome-primary), transparent 85%);
    border-color: color-mix(in srgb, var(--esphome-primary), transparent 50%);
  }

  .create-trigger:focus-visible {
    outline: none;
    box-shadow: var(--esphome-focus-ring-tight);
  }

  .create-trigger wa-icon {
    font-size: 16px;
  }

  /* ─── Standalone create dialog ───────────────────────────── */

  .create-dialog {
    --width: 460px;
  }

  .create-dialog::part(header) {
    padding: var(--wa-space-l) var(--wa-space-l) var(--wa-space-s);
  }

  .create-dialog::part(title) {
    font-size: var(--wa-font-size-m);
    font-weight: var(--wa-font-weight-bold);
    color: var(--wa-color-text-normal);
  }

  .create-dialog::part(close-button__base) {
    background: transparent;
    border: none;
    box-shadow: none;
  }

  .create-dialog::part(body) {
    padding: 0 var(--wa-space-l) var(--wa-space-l);
  }

  .create-dialog::part(footer) {
    display: none;
  }
`;
