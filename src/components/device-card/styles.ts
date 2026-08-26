import { css } from "lit";
import { actionBtnStyles } from "../../styles/action-buttons.js";

import { textStyles } from "../../styles/text.js";

export const deviceCardStyles = [
  // Shared .action-btn language (also used by ESPHome Web's cards).
  actionBtnStyles,
  textStyles,
  css`
    /* Only rendered when the device carries labels; an untagged device
       gets no chip row and the card collapses naturally. Bottom padding
       keeps the chips off the divider the actions row carries. */
    .device-card-labels {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px;
      padding: 4px var(--wa-space-m) 10px;
    }
  `,
  css`
    :host {
      display: block;
      outline: none;
      /* Intentionally no height: 100%. The .devices-grid already equalizes
         card heights via align-items: stretch (its default) and the inner
         .device-card fills this host, so a height here is redundant. It is
         also fragile: a percentage height on a grid item resolves against the
         track, which WebKit can compute as the viewport-tall grid box instead
         of the auto content track, stretching the card to full-window height. */
    }

    .device-card {
      border-radius: var(--wa-border-radius-l);
      border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
      background: var(--wa-color-surface-raised);
      overflow: visible;
      display: flex;
      flex-direction: column;
      height: 100%;
      transition: box-shadow 0.15s;
    }

    .device-card:hover {
      box-shadow: var(--wa-shadow-m);
    }

    /* Focus ring on the inner card so it follows rounded corners. */
    :host(:focus-visible) .device-card {
      outline: var(--esphome-focus-outline);
      outline-offset: 2px;
    }

    .device-card--clickable {
      cursor: pointer;
    }

    .device-card--selectable {
      cursor: pointer;
    }

    .device-card--selected {
      border-color: var(--esphome-primary);
      background: var(--esphome-tint-faint);
    }

    /* Brief accent flash for a just-adopted card — dashboard sets the
       attribute for ~4s, then clears it. */
    :host([highlight]) .device-card {
      border-color: var(--esphome-primary);
      animation: card-highlight-glow 2s ease-out 1;
    }
    @keyframes card-highlight-glow {
      0% {
        box-shadow: 0 0 0 0 color-mix(in srgb, var(--esphome-primary), transparent 40%);
      }
      50% {
        box-shadow: 0 0 0 8px color-mix(in srgb, var(--esphome-primary), transparent 65%);
      }
      100% {
        box-shadow: 0 0 0 0 color-mix(in srgb, var(--esphome-primary), transparent 100%);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      :host([highlight]) .device-card {
        animation: none;
      }
    }

    /* Three columns: select checkbox, text, status badge. Only the name row
       shares its line with the badge; the filename and comment span under
       it, so a long path or note is not cut short by dead space beneath
       the badge. Spacing is on the outer items rather than a column gap so
       an absent checkbox leaves no phantom indent. */
    .device-card-header {
      padding: var(--wa-space-m) var(--wa-space-m) var(--wa-space-s);
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      align-items: start;
      /* Grid rows stretch every card to the tallest sibling; the auto
         margin soaks up the extra height so the rows below (labels,
         divider, actions) stay bottom-anchored and line up across the
         row. */
      margin-bottom: auto;
    }

    /* Its children lay out on the header grid directly. */
    .device-card-header-left {
      display: contents;
    }
    /* The badge's tooltip is a sibling referenced by for=. Its host is
       position: absolute, so it never takes part in auto-placement; the
       pin only makes the intended cell explicit for the next reader. */
    .device-card-header > wa-tooltip {
      grid-column: 3;
      grid-row: 1;
    }
    .device-config,
    .device-comment {
      grid-column: 2 / -1;
    }

    .device-name-wrap {
      grid-column: 2;
      grid-row: 1;
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 6px;
      margin: 0 0 var(--wa-space-2xs);
    }

    .device-name {
      margin: 0;
      font-size: var(--wa-font-size-m);
      font-weight: var(--wa-font-weight-bold);
      color: var(--wa-color-text-normal);
    }

    .indicator-dot {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .indicator-dot--modified {
      background: var(--esphome-warning, #f59e0b);
      box-shadow: 0 0 5px
        color-mix(in srgb, var(--esphome-warning, #f59e0b), transparent 50%);
    }

    .indicator-dot--update {
      background: var(--esphome-primary);
      box-shadow: 0 0 5px color-mix(in srgb, var(--esphome-primary), transparent 50%);
    }

    .indicator-dot--migration {
      background: var(--esphome-migration);
      box-shadow: 0 0 5px color-mix(in srgb, var(--esphome-migration), transparent 50%);
    }

    /* The migration dot is a button that opens the editor; reset the
       native chrome so it matches the passive dots. */
    button.indicator-dot {
      position: relative;
      padding: 0;
      border: none;
      cursor: pointer;
    }
    /* Invisible hit-area extender — the 8px dot alone is too small a
       touch target (24px minimum). */
    button.indicator-dot::before {
      content: "";
      position: absolute;
      inset: -8px;
    }
    button.indicator-dot:focus-visible {
      outline: 2px solid var(--esphome-primary);
      outline-offset: 2px;
    }

    /* 4-state encryption icon — secure / insecure / pending / mismatch. */
    .encryption-icon {
      font-size: 14px;
      flex-shrink: 0;
    }
    /* Plaintext is a button that deep-links to the Enable-encryption
       affordance; reset the native chrome so it matches the passive icon. */
    button.encryption-icon {
      display: inline-flex;
      align-items: center;
      padding: 0;
      border: none;
      background: none;
      color: inherit;
      cursor: pointer;
    }
    button.encryption-icon:focus-visible {
      outline: 2px solid var(--esphome-primary);
      outline-offset: 2px;
      border-radius: var(--wa-border-radius-s);
    }
    .encryption-icon.secure {
      color: var(--esphome-success);
      opacity: 0.85;
    }
    .encryption-icon.insecure {
      color: var(--esphome-warning, #f59e0b);
    }
    .encryption-icon.pending {
      color: var(--esphome-primary);
    }
    .encryption-icon.mismatch {
      color: var(--esphome-error);
    }

    .device-config {
      margin: 0;
      font-size: var(--wa-font-size-xs);
      color: var(--wa-color-text-quiet);
    }

    /* Free-form user text under the filename, set as a standard metadata
       row: a leading glyph on an upright quiet line. The icon is what tells
       it apart from the filename above (same size, same colour); the italic
       #1671 shipped did not read as a different thing at this size. */
    .device-comment {
      display: flex;
      align-items: center;
      gap: 5px;
      min-width: 0;
      margin: 2px 0 0;
      font-size: var(--wa-font-size-xs);
      color: var(--wa-color-text-quiet);
    }
    /* wa-icon's host is 1.25em wide with the glyph centred, which pushed
       the text ~7px past the icon; hug the glyph so the line reads as one
       row starting at the filename's left edge. */
    .device-comment wa-icon {
      flex: none;
      width: 1em;
      font-size: 14px;
    }
    .device-comment .truncate {
      min-width: 0;
    }

    .device-status {
      grid-column: 3;
      grid-row: 1;
      margin-left: var(--wa-space-xs);
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 8px;
      border-radius: 999px;
      font-size: var(--wa-font-size-2xs);
      font-weight: var(--wa-font-weight-bold);
      letter-spacing: 0.02em;
      margin-top: 2px;
    }

    .device-status.offline {
      background: color-mix(in srgb, var(--esphome-error), transparent 85%);
      color: var(--esphome-error);
    }

    .device-status.online {
      background: color-mix(in srgb, var(--esphome-success), transparent 85%);
      color: var(--esphome-success);
    }

    .device-status.unknown {
      background: var(--wa-color-surface-lowered);
      color: var(--wa-color-text-quiet);
    }

    .device-status wa-icon {
      font-size: 13px;
    }

    .device-status.busy {
      background: var(--esphome-tint-strong);
      color: var(--esphome-primary);
      cursor: pointer;
    }

    /* The clickable badge is a native button; reset its chrome so the
       .device-status classes style it like the passive variant. The UA
       sheet pins font-family and line-height at element level, which
       otherwise beats the inheritance the passive div gets. */
    button.device-status {
      border: none;
      font-family: inherit;
      line-height: inherit;
    }

    .device-status.clickable {
      cursor: pointer;
    }

    .device-status.clickable:focus-visible {
      outline: 2px solid var(--esphome-primary);
      outline-offset: 2px;
    }

    .device-status.busy wa-spinner {
      font-size: 12px;
      --indicator-color: var(--esphome-primary);
      --track-color: transparent;
    }

    .device-status.completed {
      background: color-mix(in srgb, var(--esphome-success), transparent 85%);
      color: var(--esphome-success);
      animation: completed-pulse 1s ease-in-out infinite;
    }

    .indicator-queued {
      font-size: 14px;
      flex-shrink: 0;
      color: var(--esphome-warning, #f59e0b);
    }

    /* RECENT_JOB_TTL_MS_COMPLETED is short; throb signals "transient". */
    @keyframes completed-pulse {
      0%,
      100% {
        opacity: 1;
      }
      50% {
        opacity: 0.55;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .device-status.completed {
        animation: none;
      }
    }

    .device-status.failed {
      background: color-mix(in srgb, var(--esphome-error), transparent 85%);
      color: var(--esphome-error);
    }

    .device-status.cancelled {
      background: var(--wa-color-surface-lowered);
      color: var(--wa-color-text-quiet);
    }

    .device-checkbox {
      grid-column: 1;
      grid-row: 1;
      margin-right: var(--wa-space-xs);
      font-size: 22px;
      color: var(--wa-color-text-quiet);
      transition: color 0.12s;
      /* Box the glyph to the title's first-line height so it centers
         on the device name while the header grid keeps align-items:
         start (the status badge stays top-anchored). */
      display: flex;
      align-items: center;
      height: calc(var(--wa-font-size-m) * var(--wa-line-height-normal));
    }

    .device-checkbox--checked {
      color: var(--esphome-primary);
    }

    /* The divider rides on the actions row, not the header, so the
       header's auto bottom margin opens above the line and it always
       hugs the buttons. */
    .device-actions {
      display: flex;
      align-items: center;
      gap: var(--wa-space-2xs);
      padding: var(--wa-space-s) var(--wa-space-m);
      border-top: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    }
  `,
];
