import { css } from "lit";

export const dashboardStyles = css`
  :host {
    display: flex;
    flex-direction: column;
    height: calc(100vh - var(--esphome-header-height));
    overflow: hidden;
  }

  :host([view="cards"]) {
    height: auto;
    overflow: visible;
  }

  /* ─── Discovered Banner ─── */

  @keyframes banner-slide-in {
    from {
      transform: translateY(-100%);
    }
    to {
      transform: translateY(0);
    }
  }

  .discovered-banner-wrap {
    display: flex;
    justify-content: center;
    overflow: hidden;
    flex-shrink: 0;
  }

  .discovered-banner {
    display: inline-flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--wa-space-xs);
    padding: var(--wa-space-xs) var(--wa-space-l) var(--wa-space-s);
    background: var(--esphome-secondary);
    border-radius: 0 0 var(--wa-border-radius-l) var(--wa-border-radius-l);
    font-size: var(--wa-font-size-s);
    color: var(--esphome-on-primary);
    animation: banner-slide-in 1s cubic-bezier(0.4, 0, 0.2, 1) both;
  }

  .discovered-banner wa-icon {
    font-size: var(--wa-font-size-m);
    color: var(--esphome-on-primary);
    margin-right: 10px;
  }
  .discovered-banner a {
    color: var(--esphome-primary-light);
    cursor: pointer;
    text-decoration: underline;
    font-weight: var(--wa-font-weight-bold);
    font-size: var(--wa-font-size-2xs);
    margin-left: var(--wa-space-4xl);
    opacity: 0.85;
  }
  .discovered-banner a:hover {
    opacity: 1;
  }
  .discovered-banner span {
    font-weight: var(--wa-font-weight-bold);
    font-size: var(--wa-font-size-xs);
  }
  .discovered-banner-empty {
    margin-right: var(--wa-space-4xl);
  }

  /* ─── Card Grid ─── */

  .devices-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, 300px);
    gap: var(--wa-space-l);
    padding: var(--wa-space-l);
  }

  /* ─── Search toolbar ─── */

  .toolbar {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: var(--wa-space-l) var(--wa-space-l) 0;
    flex-shrink: 0;
  }
  .toolbar-row {
    display: flex;
    align-items: center;
    gap: var(--wa-space-s);
  }

  .search-wrap {
    position: relative;
    max-width: 380px;
    flex: 1;
  }
  .search-icon {
    position: absolute;
    left: 12px;
    top: 50%;
    transform: translateY(-50%);
    font-size: 18px;
    color: var(--wa-color-text-quiet);
    pointer-events: none;
    display: flex;
    align-items: center;
  }
  .search-input {
    width: 100%;
    box-sizing: border-box;
    padding: 9px 14px 9px 38px;
    font-size: var(--wa-font-size-s);
    font-family: inherit;
    color: var(--wa-color-text-normal);
    background: var(--wa-color-surface-raised);
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    border-radius: var(--wa-border-radius-l);
    outline: none;
    transition:
      border-color 0.15s,
      box-shadow 0.15s;
  }
  .search-input::placeholder {
    color: var(--wa-color-text-quiet);
  }
  .search-input:focus {
    border-color: var(--esphome-primary);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--esphome-primary), transparent 80%);
  }
  .device-count {
    font-size: var(--wa-font-size-xs);
    color: var(--wa-color-text-quiet);
    padding-left: 2px;
  }
  .device-count strong {
    color: var(--wa-color-text-normal);
    font-weight: var(--wa-font-weight-bold);
  }

  /* ─── View Toggle ─── */

  .view-toggle {
    display: inline-flex;
    border-radius: var(--wa-border-radius-m);
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    overflow: hidden;
    flex-shrink: 0;
  }

  .view-toggle-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border: none;
    background: var(--wa-color-surface-raised);
    color: var(--wa-color-text-quiet);
    cursor: pointer;
    transition:
      background 0.12s,
      color 0.12s;
    padding: 0;
  }

  .view-toggle-btn + .view-toggle-btn {
    border-left: var(--wa-border-width-s) solid var(--wa-color-surface-border);
  }

  .view-toggle-btn:hover {
    background: var(--wa-color-surface-lowered);
    color: var(--wa-color-text-normal);
  }

  .view-toggle-btn.active {
    background: var(--esphome-primary);
    color: var(--esphome-on-primary);
  }

  .view-toggle-btn.active:hover {
    background: color-mix(in srgb, var(--esphome-primary), black 10%);
  }

  .view-toggle-btn wa-icon {
    font-size: 18px;
  }

  /* ─── Empty search state ─── */

  .empty-search {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--wa-space-s);
    padding: var(--wa-space-4xl) var(--wa-space-l);
    text-align: center;
  }
  .empty-search-icon {
    font-size: 48px;
    color: color-mix(in srgb, var(--esphome-primary), transparent 60%);
    line-height: 1;
  }
  .empty-search-title {
    margin: 0;
    font-size: var(--wa-font-size-m);
    font-weight: var(--wa-font-weight-bold);
    color: var(--wa-color-text-normal);
  }
  .empty-search-desc {
    margin: 0;
    font-size: var(--wa-font-size-s);
    color: var(--wa-color-text-quiet);
    max-width: 320px;
  }
  .empty-search-clear {
    margin-top: var(--wa-space-xs);
    background: none;
    border: var(--wa-border-width-s) solid var(--esphome-primary);
    color: var(--esphome-primary);
    padding: 6px 16px;
    border-radius: var(--wa-border-radius-m);
    font-size: var(--wa-font-size-s);
    font-family: inherit;
    font-weight: var(--wa-font-weight-bold);
    cursor: pointer;
    transition: background 0.12s;
  }
  .empty-search-clear:hover {
    background: color-mix(in srgb, var(--esphome-primary), transparent 90%);
  }

  /* ─── Skeleton ─── */

  @keyframes skeleton-shimmer {
    from {
      background-position: -400px 0;
    }
    to {
      background-position: 400px 0;
    }
  }
  .skeleton-card {
    border-radius: var(--wa-border-radius-l);
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    background: var(--wa-color-surface-raised);
    overflow: hidden;
    min-height: 130px;
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-s);
    padding: var(--wa-space-m);
  }
  .skeleton-line {
    border-radius: var(--wa-border-radius-m);
    background: linear-gradient(
      90deg,
      var(--wa-color-surface-border) 25%,
      color-mix(in srgb, var(--wa-color-surface-border), var(--wa-color-surface-raised) 60%) 50%,
      var(--wa-color-surface-border) 75%
    );
    background-size: 800px 100%;
    animation: skeleton-shimmer 1.4s infinite linear;
  }
  .skeleton-line--title {
    height: 18px;
    width: 55%;
  }
  .skeleton-line--subtitle {
    height: 13px;
    width: 35%;
  }
  .skeleton-line--actions {
    height: 30px;
    width: 100%;
    margin-top: auto;
  }

  /* ─── Table Skeleton ─── */

  .skeleton-table {
    margin: var(--wa-space-l);
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    border-radius: var(--wa-border-radius-l);
    overflow: hidden;
    background: var(--wa-color-surface-raised);
    flex: 1;
    min-height: 0;
  }

  .skeleton-table-header {
    display: flex;
    gap: var(--wa-space-l);
    padding: 14px var(--wa-space-l);
    background: var(--wa-color-surface-lowered);
    border-bottom: var(--wa-border-width-s) solid var(--wa-color-surface-border);
  }

  .skeleton-table-row {
    display: flex;
    gap: var(--wa-space-l);
    padding: 14px var(--wa-space-l);
    border-bottom: var(--wa-border-width-s) solid var(--wa-color-surface-border);
  }

  .skeleton-table-row:last-child {
    border-bottom: none;
  }

  .skeleton-line--header {
    height: 12px;
    width: 100px;
  }

  .skeleton-line--cell {
    height: 14px;
    flex: 1;
  }

  .skeleton-line--cell:first-child {
    max-width: 16px;
    border-radius: 50%;
    height: 16px;
    flex: none;
  }

  /* ─── Add New Device Card ─── */

  .add-device-card {
    border: 2px dashed color-mix(in srgb, var(--esphome-primary), transparent 50%);
    border-radius: var(--wa-border-radius-l);
    padding: var(--wa-space-xl) var(--wa-space-l);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--wa-space-m);
    background: color-mix(in srgb, var(--esphome-primary), transparent 96%);
    min-height: 200px;
    cursor: pointer;
    transition:
      border-color 0.15s,
      background 0.15s,
      transform 0.15s;
  }
  .add-device-card:hover {
    border-color: var(--esphome-primary);
    background: color-mix(in srgb, var(--esphome-primary), transparent 92%);
    transform: translateY(-2px);
  }
  .add-device-icon-wrap {
    width: 52px;
    height: 52px;
    border-radius: 50%;
    background: var(--esphome-primary);
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 14px color-mix(in srgb, var(--esphome-primary), transparent 50%);
    transition:
      box-shadow 0.15s,
      transform 0.15s;
  }
  .add-device-card:hover .add-device-icon-wrap {
    box-shadow: 0 6px 20px color-mix(in srgb, var(--esphome-primary), transparent 35%);
    transform: scale(1.06);
  }
  .add-device-icon-wrap wa-icon {
    font-size: 26px;
    color: var(--esphome-on-primary);
  }
  .add-device-label {
    font-size: var(--wa-font-size-m);
    font-weight: var(--wa-font-weight-bold);
    color: var(--esphome-primary);
  }
  .add-device-hint {
    font-size: var(--wa-font-size-xs);
    color: var(--wa-color-text-quiet);
    text-align: center;
  }
  .esphome-web-link {
    display: flex;
    align-items: center;
    gap: var(--wa-space-2xs);
    font-size: var(--wa-font-size-xs);
    color: var(--wa-color-text-quiet);
    text-decoration: none;
    margin-top: var(--wa-space-2xs);
  }
  .esphome-web-link wa-icon {
    font-size: 14px;
  }
  .esphome-web-link:hover {
    color: var(--esphome-primary);
  }

  /* ─── Table Create Button ─── */

  .table-create-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0 14px;
    height: 36px;
    box-sizing: border-box;
    border-radius: var(--wa-border-radius-m);
    font-size: var(--wa-font-size-xs);
    font-weight: var(--wa-font-weight-bold);
    font-family: inherit;
    cursor: pointer;
    border: none;
    background: var(--esphome-primary);
    color: var(--esphome-on-primary);
    transition: background 0.12s;
  }

  .table-create-btn:hover {
    background: color-mix(in srgb, var(--esphome-primary), black 10%);
  }

  .table-create-btn wa-icon {
    font-size: 15px;
  }

  /* ─── FAB ─── */

  .fab-container {
    position: fixed;
    bottom: var(--wa-space-l);
    right: var(--wa-space-xl);
    z-index: 10;
  }
  .fab-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--wa-space-xs);
    padding: 12px 22px;
    border-radius: 999px;
    border: none;
    background: var(--esphome-primary);
    color: var(--esphome-on-primary);
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-bold);
    font-family: inherit;
    cursor: pointer;
    box-shadow:
      0 4px 14px color-mix(in srgb, var(--esphome-primary), transparent 40%),
      0 2px 4px rgba(0, 0, 0, 0.12);
    transition:
      transform 0.15s,
      box-shadow 0.15s,
      background 0.15s;
    letter-spacing: 0.01em;
  }
  .fab-btn:hover {
    background: color-mix(in srgb, var(--esphome-primary), black 10%);
    transform: translateY(-2px);
    box-shadow:
      0 8px 24px color-mix(in srgb, var(--esphome-primary), transparent 30%),
      0 4px 8px rgba(0, 0, 0, 0.14);
  }
  .fab-btn:active {
    transform: translateY(0);
  }
  .fab-btn wa-icon {
    font-size: 18px;
  }
`;
