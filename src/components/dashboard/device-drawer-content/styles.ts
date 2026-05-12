import { css } from "lit";

export const deviceDrawerContentStyles = css`
  :host {
    display: block;
  }

  .section {
    margin-bottom: var(--wa-space-l);
  }

  .section-title {
    font-size: var(--wa-font-size-2xs);
    font-weight: var(--wa-font-weight-bold);
    color: var(--wa-color-text-quiet);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin: 0 0 var(--wa-space-s);
    padding-bottom: var(--wa-space-xs);
    border-bottom: var(--wa-border-width-s) solid var(--wa-color-surface-border);
  }

  .row {
    display: flex;
    align-items: flex-start;
    gap: var(--wa-space-s);
    padding: var(--wa-space-xs) 0;
  }

  .row + .row {
    border-top: var(--wa-border-width-s) solid
      color-mix(in srgb, var(--wa-color-surface-border), transparent 50%);
  }

  .icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: var(--wa-border-radius-m);
    background: color-mix(in srgb, var(--esphome-primary), transparent 90%);
    flex-shrink: 0;
    margin-top: 2px;
  }

  .icon wa-icon {
    font-size: 16px;
    color: var(--esphome-primary);
  }

  .content {
    flex: 1;
    min-width: 0;
  }

  .label {
    font-size: var(--wa-font-size-2xs);
    color: var(--wa-color-text-quiet);
    margin-bottom: 2px;
  }

  .value {
    font-size: var(--wa-font-size-s);
    color: var(--wa-color-text-normal);
    word-break: break-word;
  }

  .value.mono {
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
    font-size: var(--wa-font-size-xs);
  }

  .value.muted {
    color: var(--wa-color-text-quiet);
    font-style: italic;
  }

  .ip-toggle {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 2px 0;
    margin-top: 2px;
    background: none;
    border: none;
    font-family: inherit;
    font-size: var(--wa-font-size-2xs);
    color: var(--wa-color-text-quiet);
    cursor: pointer;
  }
  .ip-toggle:hover {
    color: var(--wa-color-text-normal);
  }
  .ip-toggle wa-icon {
    font-size: 14px;
  }

  .ip-value {
    display: inline-flex;
    align-items: center;
    gap: var(--wa-space-xs);
    max-width: 100%;
  }
  .ip-value-text {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .ip-visit-link {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 24px;
    height: 24px;
    border-radius: var(--wa-border-radius-m);
    color: var(--wa-color-text-quiet);
    text-decoration: none;
    transition:
      background 0.12s,
      color 0.12s;
  }
  .ip-visit-link:hover {
    background: var(--wa-color-surface-lowered);
    color: var(--esphome-primary);
  }
  .ip-visit-link:focus-visible {
    outline: 2px solid var(--esphome-primary);
    outline-offset: 2px;
    color: var(--esphome-primary);
  }
  .ip-visit-link wa-icon {
    font-size: 14px;
  }

  .build-size-value {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  .build-size-clean {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border: none;
    border-radius: var(--wa-border-radius-s);
    background: none;
    color: var(--wa-color-text-quiet);
    cursor: pointer;
  }
  .build-size-clean:hover {
    color: var(--wa-color-text-normal);
    background: color-mix(in srgb, var(--esphome-primary), transparent 88%);
  }
  /* aria-disabled instead of disabled so the title tooltip stays discoverable;
     the click handler is gated separately on the busy property. */
  .build-size-clean--disabled,
  .build-size-clean--disabled:hover {
    color: var(--wa-color-text-quiet);
    background: none;
    cursor: not-allowed;
    opacity: 0.5;
  }
  .build-size-clean wa-icon {
    font-size: 14px;
  }

  .tags-wrap {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 4px;
  }

  .tag {
    display: inline-flex;
    padding: 3px 10px;
    border-radius: var(--wa-border-radius-m);
    font-size: var(--wa-font-size-2xs);
    font-weight: var(--wa-font-weight-bold);
    background: var(--wa-color-surface-lowered);
    color: var(--wa-color-text-quiet);
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
  }

  .tag--link {
    color: var(--esphome-primary);
    text-decoration: none;
    cursor: pointer;
    transition:
      background 0.12s,
      border-color 0.12s;
  }

  .tag--link:hover,
  .tag--link:focus-visible {
    background: color-mix(in srgb, var(--esphome-primary), transparent 90%);
    border-color: color-mix(in srgb, var(--esphome-primary), transparent 60%);
  }

  .tag--link:focus-visible {
    outline: 2px solid var(--esphome-primary);
    outline-offset: 2px;
  }

  .auto-loaded-details > summary,
  .mdns-txt-details > summary {
    cursor: pointer;
    font-size: var(--wa-font-size-2xs);
    color: var(--wa-color-text-quiet);
    padding: 2px 0;
    user-select: none;
  }

  .auto-loaded-details > summary:hover,
  .mdns-txt-details > summary:hover {
    color: var(--wa-color-text-normal);
  }

  .auto-loaded-details {
    margin-top: var(--wa-space-s);
  }

  .mdns-txt-details {
    margin-top: var(--wa-space-2xs);
  }

  .tags-wrap--auto-loaded {
    margin-top: var(--wa-space-2xs);
  }

  /* TXT keys/values are device-controlled — minmax(0, max-content) +
     overflow-wrap: anywhere defends against an absurdly long key
     pushing the drawer's horizontal scrollbar. */
  .mdns-txt-list {
    display: grid;
    grid-template-columns: minmax(0, max-content) 1fr;
    column-gap: var(--wa-space-s);
    row-gap: 2px;
    margin: var(--wa-space-2xs) 0 0 0;
    font-size: var(--wa-font-size-2xs);
  }

  .mdns-txt-list > dt {
    color: var(--wa-color-text-quiet);
    font-family: var(--wa-font-family-code, monospace);
    overflow-wrap: anywhere;
  }

  .mdns-txt-list > dd {
    margin: 0;
    font-family: var(--wa-font-family-code, monospace);
    overflow-wrap: anywhere;
  }

  .status-badges {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: var(--wa-space-l);
  }

  .status-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 10px;
    border-radius: 999px;
    font-size: var(--wa-font-size-2xs);
    font-weight: var(--wa-font-weight-bold);
    letter-spacing: 0.02em;
  }

  .status-badge wa-icon {
    font-size: 13px;
  }

  .status-badge--modified {
    background: color-mix(in srgb, var(--esphome-warning, #f59e0b), transparent 85%);
    color: var(--esphome-warning, #d97706);
  }

  .status-badge--update {
    background: color-mix(in srgb, var(--esphome-primary), transparent 88%);
    color: var(--esphome-primary);
  }

  .status-badge--encrypted {
    background: color-mix(in srgb, var(--esphome-success), transparent 88%);
    color: var(--esphome-success);
  }

  .status-badge--unencrypted {
    background: color-mix(in srgb, var(--esphome-warning, #f59e0b), transparent 85%);
    color: var(--esphome-warning, #d97706);
  }

  .status-badge--encryption-pending {
    background: color-mix(in srgb, var(--esphome-primary), transparent 88%);
    color: var(--esphome-primary);
  }

  .status-badge--encryption-mismatch {
    background: color-mix(in srgb, var(--esphome-error), transparent 88%);
    color: var(--esphome-error);
  }

  .sync-status {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: 999px;
    font-size: var(--wa-font-size-2xs);
    font-weight: var(--wa-font-weight-bold);
    margin-bottom: var(--wa-space-s);
  }

  .sync-status wa-icon {
    font-size: 13px;
  }

  .sync-status--match {
    background: color-mix(in srgb, var(--esphome-success), transparent 88%);
    color: var(--esphome-success);
  }

  .sync-status--diff {
    background: color-mix(in srgb, var(--esphome-warning, #f59e0b), transparent 85%);
    color: var(--esphome-warning, #d97706);
  }

  .reachability-badge {
    display: inline-flex;
    align-items: center;
    margin-left: 6px;
    padding: 1px 6px;
    border-radius: 999px;
    font-size: 0.7em;
    font-weight: var(--wa-font-weight-bold);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    background: color-mix(in srgb, var(--esphome-success), transparent 85%);
    color: var(--esphome-success);
  }

  .reachability-rtt {
    color: var(--wa-color-text-quiet);
  }
`;
