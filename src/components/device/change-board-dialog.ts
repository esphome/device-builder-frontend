import { consume } from "@lit/context";
import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { BoardCatalogEntry } from "../../api/types/boards.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { localizeContext } from "../../context/index.js";
import {
  dialogChromeStyles,
  quietCloseButtonStyles,
} from "../../styles/dialog-chrome.js";
import { espHomeStyles } from "../../styles/shared.js";
import { withBase } from "../../util/base-path.js";
import { changeBoardDialogStyles } from "./change-board-dialog.styles.js";

import "@home-assistant/webawesome/dist/components/badge/badge.js";
import "../base-dialog.js";

const FALLBACK_BOARD_IMAGE = "/assets/board/default.svg";

/**
 * Picker for swapping a device's board to an interchangeable one. Bind
 * `.currentBoard` and `.boards`, open via `open()`; emits a bubbling
 * `select-board` with `{ boardId }` on selection.
 */
@customElement("esphome-change-board-dialog")
export class ESPHomeChangeBoardDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  /** The device's current board — shown for context, never in the list. */
  @property({ attribute: false })
  currentBoard: BoardCatalogEntry | null = null;

  /** Alternate boards to choose from (current board already excluded). */
  @property({ attribute: false })
  boards: BoardCatalogEntry[] = [];

  @state()
  private _open = false;

  static styles = [
    espHomeStyles,
    dialogChromeStyles,
    quietCloseButtonStyles,
    changeBoardDialogStyles,
  ];

  open() {
    this._open = true;
  }

  close() {
    this._open = false;
  }

  // esphome-base-dialog never mutates its own open in response to user
  // actions, so the host owns flipping _open on the initiating close.
  private _onRequestClose = (): void => {
    this._open = false;
  };

  protected render() {
    return html`
      <esphome-base-dialog
        ?open=${this._open}
        .label=${this._localize("device.change_board_title")}
        @request-close=${this._onRequestClose}
      >
        <p class="intro">
          ${this._localize("device.change_board_desc", {
            name: this.currentBoard?.name ?? "",
          })}
        </p>
        <div class="board-list" role="list">
          ${this.boards.map((board) => this._renderBoard(board))}
        </div>
        <div class="actions">
          <button class="btn btn--cancel" @click=${this.close}>
            ${this._localize("layout.cancel")}
          </button>
        </div>
      </esphome-base-dialog>
    `;
  }

  private _renderBoard(board: BoardCatalogEntry) {
    return html`
      <button
        type="button"
        class="board-row"
        role="listitem"
        @click=${() => this._select(board)}
      >
        <img
          class="board-thumb"
          src=${this._boardImageUrl(board)}
          alt=${board.name}
          referrerpolicy="no-referrer"
          @error=${this._onImageError}
        />
        <div class="board-meta">
          <span class="board-name">${board.name}</span>
          ${board.manufacturer
            ? html`<span class="board-mfr">${board.manufacturer}</span>`
            : nothing}
        </div>
        ${board.is_generic
          ? html`<wa-badge variant="neutral" pill
              >${this._localize("device.change_board_generic_tag")}</wa-badge
            >`
          : nothing}
      </button>
    `;
  }

  private _boardImageUrl(board: BoardCatalogEntry): string {
    if (board.images.length > 0) return board.images[0];
    return withBase(FALLBACK_BOARD_IMAGE);
  }

  private _onImageError(e: Event) {
    const img = e.target as HTMLImageElement;
    const fallback = withBase(FALLBACK_BOARD_IMAGE);
    if (img.src !== window.location.origin + fallback && !img.src.endsWith(fallback)) {
      img.src = fallback;
    }
  }

  private _select(board: BoardCatalogEntry) {
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
