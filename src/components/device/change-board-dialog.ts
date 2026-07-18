import { consume } from "@lit/context";
import { LitElement, html, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { SlimBoard } from "../../api/types/boards.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { localizeContext } from "../../context/index.js";
import {
  dialogActionButtonStyles,
  dialogActionsRowStyles,
} from "../../styles/dialog-action-buttons.js";
import {
  dialogChromeStyles,
  quietCloseButtonStyles,
} from "../../styles/dialog-chrome.js";
import { inputStyles } from "../../styles/inputs.js";
import { loadMoreFooterStyles } from "../../styles/load-more-footer.js";
import { espHomeStyles } from "../../styles/shared.js";
import { boardImageUrl, onBoardImageError } from "../../util/board-image.js";
import { DialogOpenController } from "../../util/dialog-open-controller.js";
import { IntersectionController } from "../../util/intersection-controller.js";
import { renderLoadMoreFooter } from "../shared/load-more-footer.js";
import { changeBoardDialogStyles } from "./change-board-dialog.styles.js";

import "@home-assistant/webawesome/dist/components/badge/badge.js";
import "../base-dialog.js";

/**
 * Picker for swapping a device's board to an interchangeable one. Bind
 * `.currentBoard` and `.boards`, open via `open()`; emits a bubbling
 * `select-board` with `{ boardId }` on selection. A server-paged owner
 * additionally binds `hasMore` / `loadingMore` / `loadError` and appends
 * pages on the `load-more` event.
 */
@customElement("esphome-change-board-dialog")
export class ESPHomeChangeBoardDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  /** The device's current board — shown for context, never in the list. */
  @property({ attribute: false })
  currentBoard: SlimBoard | null = null;

  /** Alternate boards to choose from (current board already excluded). */
  @property({ attribute: false })
  boards: SlimBoard[] = [];

  /** Title override; empty falls back to the change-board copy. */
  @property()
  heading = "";

  /** Intro override; empty falls back to the change-board copy. */
  @property()
  description = "";

  /** More pages remain; renders the infinite-scroll sentinel. */
  @property({ type: Boolean })
  hasMore = false;

  /** A page append is in flight. */
  @property({ type: Boolean })
  loadingMore = false;

  /** A page load failed. With rows shown this renders the retry
   *  affordance; with none, the empty state reads as an error. */
  @property({ type: Boolean })
  loadError = false;

  /** Renders a filter input; emits `search-changed` with `{ value }`. */
  @property({ type: Boolean })
  searchable = false;

  @query(".board-search")
  private _searchInput?: HTMLInputElement | null;

  private readonly _dialog = new DialogOpenController(this);

  // The board list is always its own scroll box, so observe against it
  // directly — an explicit root also makes the prefetch margin apply to
  // the box the user actually scrolls, unlike the viewport-root form.
  private readonly _intersection = new IntersectionController(
    this,
    () => this._requestLoadMore(),
    { rootSelector: ".board-list" }
  );

  static styles = [
    espHomeStyles,
    dialogChromeStyles,
    quietCloseButtonStyles,
    dialogActionsRowStyles,
    dialogActionButtonStyles,
    inputStyles,
    changeBoardDialogStyles,
    loadMoreFooterStyles,
  ];

  open() {
    // Uncontrolled input — a stale query from the last open is cleared here.
    if (this._searchInput) this._searchInput.value = "";
    this._dialog.open = true;
  }

  close() {
    this._dialog.open = false;
  }

  protected render() {
    return html`
      <esphome-base-dialog
        ?open=${this._dialog.open}
        .label=${this.heading || this._localize("device.change_board_title")}
        @request-close=${this._dialog.onRequestClose}
      >
        <p class="intro">
          ${
            this.description ||
            this._localize("device.change_board_desc", {
              name: this.currentBoard?.name ?? "",
            })
          }
        </p>
        ${
          this.searchable
            ? html`<input
                class="board-search"
                type="search"
                autofocus
                placeholder=${this._localize("wizard.search_boards_placeholder")}
                aria-label=${this._localize("wizard.search_boards_placeholder")}
                @input=${this._onSearchInput}
              />`
            : nothing
        }
        <div class="board-list">
          ${
            this.boards.length === 0 && this.searchable && !this.loadingMore
              ? html`<p class="load-more-loading-compact">
                  ${this._localize(
                    this.loadError ? "wizard.boards_load_error" : "wizard.no_boards_found"
                  )}
                </p>`
              : nothing
          }
          ${this.boards.map((board) => this._renderBoard(board))}
          ${renderLoadMoreFooter({
            loadingMore: this.loadingMore,
            error: this.loadError && this.boards.length > 0,
            hasMore: this.hasMore,
            localize: this._localize,
            loadingLabelKey: "wizard.loading_boards",
            errorLabelKey: "wizard.boards_load_more_error",
            onRetry: this._requestLoadMore,
            loadingClass: "load-more-loading-compact",
          })}
        </div>
        <div class="actions">
          <button class="btn btn--cancel" @click=${this.close}>
            ${this._localize("layout.cancel")}
          </button>
        </div>
      </esphome-base-dialog>
    `;
  }

  private _renderBoard(board: SlimBoard) {
    return html`
      <button type="button" class="board-row" @click=${() => this._select(board)}>
        <img
          class="board-thumb"
          src=${boardImageUrl(board)}
          alt=${board.name}
          referrerpolicy="no-referrer"
          @error=${onBoardImageError}
        />
        <div class="board-meta">
          <span class="board-name">${board.name}</span>
          ${
            board.manufacturer
              ? html`<span class="board-mfr">${board.manufacturer}</span>`
              : nothing
          }
        </div>
        ${
          board.is_generic
            ? html`<wa-badge variant="neutral" pill
                >${this._localize("device.change_board_generic_tag")}</wa-badge
              >`
            : nothing
        }
      </button>
    `;
  }

  private _requestLoadMore = () => {
    this.dispatchEvent(new CustomEvent("load-more"));
  };

  private _onSearchInput = (e: Event) => {
    this.dispatchEvent(
      new CustomEvent<{ value: string }>("search-changed", {
        detail: { value: (e.target as HTMLInputElement).value },
      })
    );
  };

  private _select(board: SlimBoard) {
    this.close();
    this.dispatchEvent(
      new CustomEvent<{ boardId: string }>("select-board", {
        detail: { boardId: board.id },
        bubbles: true,
        composed: true,
      })
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-change-board-dialog": ESPHomeChangeBoardDialog;
  }
}
