import { css } from "lit";

export const deviceCardStyles = [
  css`
    /* Only rendered when the device carries labels; an untagged device
       gets no chip row and the card collapses naturally. Padding leans
       top-heavy because the actions row below carries its own top padding. */
    .device-card-labels {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px;
      padding: 8px var(--wa-space-m) 4px;
    }
  `,
  css`
    :host {
      display: block;
      outline: none;
      height: 100%;
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
      outline: 2px solid var(--esphome-primary);
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
      background: color-mix(in srgb, var(--esphome-primary), transparent 95%);
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

    .device-card-header {
      padding: var(--wa-space-m) var(--wa-space-m) var(--wa-space-s);
      border-bottom: var(--wa-border-width-s) solid var(--wa-color-surface-border);
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: var(--wa-space-xs);
    }

    .device-card-header:last-child {
      border-bottom: none;
    }

    .device-card-header-left {
      flex: 1;
      min-width: 0;
    }

    .device-name-wrap {
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
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
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

    /* 4-state encryption icon — secure / insecure / pending / mismatch. */
    .encryption-icon {
      font-size: 14px;
      flex-shrink: 0;
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
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .device-status {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 8px;
      border-radius: 999px;
      font-size: var(--wa-font-size-2xs);
      font-weight: var(--wa-font-weight-bold);
      letter-spacing: 0.02em;
      flex-shrink: 0;
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
      background: color-mix(in srgb, var(--esphome-primary), transparent 85%);
      color: var(--esphome-primary);
      cursor: pointer;
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

    .action-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
      pointer-events: none;
    }

    .device-checkbox {
      font-size: 22px;
      color: var(--wa-color-text-quiet);
      flex-shrink: 0;
      transition: color 0.12s;
    }

    .device-checkbox--checked {
      color: var(--esphome-primary);
    }

    .device-actions {
      display: flex;
      align-items: center;
      gap: var(--wa-space-2xs);
      padding: var(--wa-space-s) var(--wa-space-m);
      margin-top: auto;
    }

    .action-btn {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 5px 12px;
      border-radius: var(--wa-border-radius-m);
      font-size: var(--wa-font-size-xs);
      font-weight: var(--wa-font-weight-bold);
      font-family: inherit;
      cursor: pointer;
      border: var(--wa-border-width-s) solid transparent;
      /* Reset anchor presentation so the Visit Web UI link matches buttons. */
      text-decoration: none;
      transition:
        background 0.12s,
        border-color 0.12s;
      white-space: nowrap;
      min-width: 0;
    }

    .action-btn wa-icon {
      font-size: 15px;
    }

    .action-btn--primary {
      background: var(--esphome-primary);
      color: var(--esphome-on-primary);
    }

    .action-btn--primary:hover {
      background: color-mix(in srgb, var(--esphome-primary), black 10%);
    }

    .action-btn--accent {
      background: color-mix(in srgb, var(--esphome-primary), transparent 90%);
      color: var(--esphome-primary);
      border-color: color-mix(in srgb, var(--esphome-primary), transparent 70%);
    }

    .action-btn--accent:hover {
      background: color-mix(in srgb, var(--esphome-primary), transparent 82%);
      border-color: var(--esphome-primary);
    }

    .action-btn--ghost {
      background: transparent;
      color: var(--wa-color-text-normal);
      border-color: var(--wa-color-surface-border);
    }

    .action-btn--ghost:hover {
      background: var(--wa-color-surface-lowered);
      border-color: var(--wa-color-text-quiet);
    }

    .action-btn--icon-only {
      padding: 5px;
      flex-shrink: 0;
      margin-left: auto;
    }

    /* Compact icon-only that sits inline with labelled buttons — same
       visual size as the kebab but without the auto left-margin. */
    .action-btn--tile {
      padding: 5px;
      flex-shrink: 0;
    }
  `,
];
