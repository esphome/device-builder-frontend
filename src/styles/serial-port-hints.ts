import { css } from "lit";

/**
 * Styles for the serial-port badge column and the replug hint rendered
 * by `renderSerialPortBadges` / `renderSerialPortReplugHint`
 * (src/components/shared/serial-port-hints.ts). The "New" badge itself
 * comes from `newItemHighlightStyles`.
 */
export const serialPortHintStyles = css`
  .badges {
    flex-shrink: 0;
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: var(--wa-space-xs);
  }

  .esp-badge {
    flex-shrink: 0;
    padding: 1px var(--wa-space-xs);
    border-radius: var(--wa-border-radius-pill, 999px);
    border: var(--wa-border-width-s) solid var(--esphome-primary);
    color: var(--esphome-primary);
    font-size: var(--wa-font-size-2xs);
    font-weight: var(--wa-font-weight-bold);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .port-hint {
    margin: var(--wa-space-s) 0 var(--wa-space-2xs);
    color: var(--wa-color-text-quiet);
    font-size: var(--wa-font-size-2xs);
    line-height: 1.4;
  }
`;
