import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";

import { espHomeStyles } from "../../styles/shared.js";

/** Pill flavour, mirroring the builder card's ``.device-status`` classes. */
export type WebCardStatusVariant = "online" | "offline" | "neutral";

/**
 * Presentational card for the ESPHome Web dashboard, replicating the main
 * builder's device-card chrome: raised surface, bordered rounded box, a
 * header row with the bold title on the left and a status pill on the right,
 * content, then a compact actions row. The pill palette mirrors
 * ``device-card/styles.ts``'s ``.device-status`` states so the two dashboards
 * read identically.
 */
@customElement("esphome-web-card")
export class ESPHomeWebCard extends LitElement {
  /** Status pill text (e.g. "Connected"). Empty = no pill. */
  @property() status = "";

  /** Pill flavour: success tint, error tint, or quiet neutral. */
  @property() variant: WebCardStatusVariant = "neutral";

  protected render() {
    return html`
      <div class="card">
        <div class="card-header">
          <div class="card-header-left">
            <h3 class="card-title"><slot name="header"></slot></h3>
          </div>
          ${
            this.status
              ? html`<div class="device-status ${this.variant}">${this.status}</div>`
              : nothing
          }
        </div>
        <div class="card-content"><slot></slot></div>
        <div class="card-actions"><slot name="actions"></slot></div>
      </div>
    `;
  }

  static styles = [
    espHomeStyles,
    css`
      :host {
        display: block;
      }
      .card {
        border-radius: var(--wa-border-radius-l);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        background: var(--wa-color-surface-raised);
        display: flex;
        flex-direction: column;
        transition: box-shadow 0.15s;
      }
      .card:hover {
        box-shadow: var(--wa-shadow-m);
      }
      .card-header {
        padding: var(--wa-space-m) var(--wa-space-m) var(--wa-space-s);
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: var(--wa-space-xs);
      }
      .card-header-left {
        flex: 1;
        min-width: 0;
      }
      .card-title {
        margin: 0;
        font-size: var(--wa-font-size-m);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-normal);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      /* Builder pill palette — keep in sync with device-card's
         .device-status states. */
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
      .device-status.online {
        background: color-mix(in srgb, var(--esphome-success), transparent 85%);
        color: var(--esphome-success);
      }
      .device-status.offline {
        background: color-mix(in srgb, var(--esphome-error), transparent 85%);
        color: var(--esphome-error);
      }
      .device-status.neutral {
        background: var(--wa-color-surface-lowered);
        color: var(--wa-color-text-quiet);
      }
      .card-content {
        /* Bottom padding keeps action-less cards (unsupported) from ending
           flush; cards with actions absorb it into the row's top padding. */
        padding: 0 var(--wa-space-m) var(--wa-space-s);
        font-size: var(--wa-font-size-s);
        color: var(--wa-color-text-quiet);
        line-height: var(--wa-line-height-normal);
      }
      .card-actions {
        margin-top: auto;
      }
      /* The actions row itself lives in the consumer's slotted div (it owns
         the .action-btn styling); this wrapper only pins it to the bottom. */
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-web-card": ESPHomeWebCard;
  }
}
