import {
  mdiChevronLeft,
  mdiChevronRight,
  mdiPageFirst,
  mdiPageLast,
} from "@mdi/js";
import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { espHomeStyles } from "../../styles/shared.js";
import { registerMdiIcons } from "../../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({
  "chevron-left": mdiChevronLeft,
  "chevron-right": mdiChevronRight,
  "page-first": mdiPageFirst,
  "page-last": mdiPageLast,
});

@customElement("esphome-table-pagination")
export class ESPHomeTablePagination extends LitElement {
  @property({ type: Number, attribute: "page-index" })
  pageIndex = 0;

  @property({ type: Number, attribute: "page-count" })
  pageCount = 0;

  @property({ type: Number, attribute: "page-size" })
  pageSize = 25;

  @property({ type: Number, attribute: "total-rows" })
  totalRows = 0;

  @property({ type: Boolean, attribute: "can-previous-page" })
  canPreviousPage = false;

  @property({ type: Boolean, attribute: "can-next-page" })
  canNextPage = false;

  static styles = [
    espHomeStyles,
    css`
      :host {
        display: block;
      }

      .pagination {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--wa-space-m) var(--wa-space-l);
        flex-wrap: wrap;
        gap: var(--wa-space-s);
      }

      .info {
        font-size: var(--wa-font-size-xs);
        color: var(--wa-color-text-quiet);
      }

      .controls {
        display: flex;
        align-items: center;
        gap: var(--wa-space-m);
      }

      .page-size {
        display: flex;
        align-items: center;
        gap: var(--wa-space-xs);
        font-size: var(--wa-font-size-xs);
        color: var(--wa-color-text-quiet);
      }

      .page-size select {
        padding: 4px 8px;
        border-radius: var(--wa-border-radius-m);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        background: var(--wa-color-surface-raised);
        color: var(--wa-color-text-normal);
        font-size: var(--wa-font-size-xs);
        font-family: inherit;
        cursor: pointer;
      }

      .page-info {
        font-size: var(--wa-font-size-xs);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-normal);
        min-width: 100px;
        text-align: center;
      }

      .buttons {
        display: flex;
        align-items: center;
        gap: 2px;
      }

      .page-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 30px;
        height: 30px;
        border-radius: var(--wa-border-radius-m);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        background: var(--wa-color-surface-raised);
        color: var(--wa-color-text-normal);
        cursor: pointer;
        transition: background 0.12s, border-color 0.12s;
        padding: 0;
      }

      .page-btn:hover:not(:disabled) {
        background: var(--wa-color-surface-lowered);
        border-color: var(--wa-color-text-quiet);
      }

      .page-btn:disabled {
        opacity: 0.35;
        cursor: not-allowed;
      }

      .page-btn wa-icon {
        font-size: 16px;
      }
    `,
  ];

  protected render() {
    return html`
      <div class="pagination">
        <span class="info">${this.totalRows} row(s) total</span>
        <div class="controls">
          <div class="page-size">
            <span>Rows per page</span>
            <select @change=${this._onPageSizeChange}>
              ${[10, 20, 25, 50, 100].map(
                (size) =>
                  html`<option value=${size} ?selected=${this.pageSize === size}>
                    ${size}
                  </option>`,
              )}
            </select>
          </div>
          <span class="page-info">
            Page ${this.pageIndex + 1} of ${this.pageCount || 1}
          </span>
          <div class="buttons">
            <button
              class="page-btn"
              ?disabled=${!this.canPreviousPage}
              @click=${() => this._emitPageChange(0)}
              title="First page"
            >
              <wa-icon library="mdi" name="page-first"></wa-icon>
            </button>
            <button
              class="page-btn"
              ?disabled=${!this.canPreviousPage}
              @click=${() => this._emitPageChange(this.pageIndex - 1)}
              title="Previous page"
            >
              <wa-icon library="mdi" name="chevron-left"></wa-icon>
            </button>
            <button
              class="page-btn"
              ?disabled=${!this.canNextPage}
              @click=${() => this._emitPageChange(this.pageIndex + 1)}
              title="Next page"
            >
              <wa-icon library="mdi" name="chevron-right"></wa-icon>
            </button>
            <button
              class="page-btn"
              ?disabled=${!this.canNextPage}
              @click=${() => this._emitPageChange(this.pageCount - 1)}
              title="Last page"
            >
              <wa-icon library="mdi" name="page-last"></wa-icon>
            </button>
          </div>
        </div>
      </div>
    `;
  }

  private _onPageSizeChange(e: Event) {
    this.dispatchEvent(
      new CustomEvent("page-size-change", {
        detail: Number((e.target as HTMLSelectElement).value),
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _emitPageChange(pageIndex: number) {
    this.dispatchEvent(
      new CustomEvent("page-change", {
        detail: pageIndex,
        bubbles: true,
        composed: true,
      }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-table-pagination": ESPHomeTablePagination;
  }
}
