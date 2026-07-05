import { css } from "lit";

/**
 * Shared chrome for the hand-rolled popover menus (header
 * overflow menu, table row kebab, column toggle).
 *
 * Provides:
 *
 *   .backdrop           — full-viewport click-away layer under
 *                         the menu (fixed, inset 0, z-index 100).
 *   .menu               — the floating panel: raised surface,
 *                         border, radius, shadow, vertical
 *                         padding, and the menu-in entrance
 *                         animation. Positioning (fixed vs
 *                         absolute) defaults to fixed; width
 *                         (min-width) is a per-consumer concern
 *                         and intentionally not set here.
 *   @keyframes menu-in  — fade + scale entrance.
 *   .menu-item          — one row: flex, icon gap, padding,
 *                         hover tint.
 *
 * Consumers drop this fragment into their ``static styles``
 * array BEFORE their local ``css`` block so local rules of equal
 * specificity (min-width, z-index tweaks, an alternative
 * ``@keyframes menu-in``) override the shared ones in cascade
 * order. Item modifiers (--danger, --disabled, --active, icon
 * colouring) stay in the consumer's local styles.
 */
export const dropdownMenuStyles = css`
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 100;
  }

  .menu {
    position: fixed;
    z-index: 101;
    background: var(--wa-color-surface-raised);
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    border-radius: var(--wa-border-radius-l);
    box-shadow: var(--wa-shadow-l);
    padding: var(--wa-space-xs) 0;
    animation: menu-in 0.12s ease-out;
  }

  @keyframes menu-in {
    from {
      opacity: 0;
      transform: scale(0.95);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  .menu-item {
    display: flex;
    align-items: center;
    gap: var(--wa-space-s);
    padding: 8px var(--wa-space-m);
    font-size: var(--wa-font-size-xs);
    color: var(--wa-color-text-normal);
    cursor: pointer;
    transition: background 0.1s;
    user-select: none;
  }

  .menu-item:hover {
    background: var(--esphome-tint);
  }
`;
