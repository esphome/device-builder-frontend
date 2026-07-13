import { css } from "lit";

export const guidedTourStyles = css`
  :host {
    display: contents;
  }

  .tour-popover {
    position: fixed;
    inset: 0;
    width: auto;
    height: auto;
    max-width: 100vw;
    max-height: 100vh;
    margin: 0;
    padding: 0;
    border: 0;
    background: transparent;
    overflow: visible;
    pointer-events: none;
  }

  .caret {
    position: absolute;
    width: 13px;
    height: 13px;
    background: var(--wa-color-surface-raised, #fff);
    transform: rotate(45deg);
    border-radius: 2px;
  }

  .bubble {
    position: absolute;
    background: var(--wa-color-surface-raised, #fff);
    color: var(--wa-color-text-normal);
    border-radius: var(--wa-border-radius-l);
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.32);
    padding: var(--wa-space-l) var(--wa-space-l) var(--wa-space-m);
    pointer-events: auto;
    box-sizing: border-box;
  }

  .step-label {
    font-size: 11px;
    font-weight: var(--wa-font-weight-bold);
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--esphome-primary);
  }

  .bubble h2 {
    margin: var(--wa-space-2xs) 0 0;
    font-size: var(--wa-font-size-m);
    font-weight: var(--wa-font-weight-bold);
  }

  .bubble p {
    margin: var(--wa-space-xs) 0 0;
    font-size: var(--wa-font-size-s);
    color: var(--wa-color-text-quiet);
    line-height: 1.5;
  }

  .hint {
    display: flex;
    align-items: center;
    gap: var(--wa-space-xs);
    margin-top: var(--wa-space-m);
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-semibold);
    color: var(--esphome-primary);
  }

  .hint-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--esphome-primary);
    animation: tour-pulse 1.4s infinite;
    flex-shrink: 0;
  }

  @keyframes tour-pulse {
    0%,
    100% {
      box-shadow: 0 0 0 0 color-mix(in srgb, var(--esphome-primary), transparent 55%);
    }
    50% {
      box-shadow: 0 0 0 7px color-mix(in srgb, var(--esphome-primary), transparent 100%);
    }
  }

  .actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: var(--wa-space-m);
  }

  .actions.action-only {
    justify-content: flex-start;
  }

  .btn {
    font-family: inherit;
    font-size: var(--wa-font-size-s);
    cursor: pointer;
    border: none;
    background: none;
    border-radius: var(--wa-border-radius-pill);
    pointer-events: auto;
  }

  .btn-skip {
    color: var(--wa-color-text-quiet);
    padding: var(--wa-space-2xs) 0;
  }

  .btn-skip:hover,
  .btn-skip.hovered {
    color: var(--wa-color-text-normal);
  }

  .btn-next {
    font-weight: var(--wa-font-weight-bold);
    color: var(--esphome-on-primary);
    background: var(--esphome-primary);
    padding: var(--wa-space-xs) var(--wa-space-l);
  }

  .btn-next:hover {
    background: var(--esphome-primary-hover);
  }

  @media (prefers-reduced-motion: reduce) {
    .hint-dot {
      animation: none;
    }
  }
`;
