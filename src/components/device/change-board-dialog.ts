import { consume } from "@lit/context";
import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
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
import { espHomeStyles } from "../../styles/shared.js";
import { boardImageUrl, onBoardImageError } from "../../util/board-image.js";
import { DialogOpenController } from "../../util/dialog-open-controller.js";
import { changeBoardDialogStyles } from "./change-board-dialog.styles.js";

import "@home-assistant/webawesome/dist/components/badge/badge.js";
import "../base-dialog.js";

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
  currentBoard: SlimBoard | null = null;

  /** Alternate boards to choose from (current board already excluded). */
  @property({ attribute: false })
  boards: SlimBoard[] = [];

  private readonly _dialog = new DialogOpenController(this);

  static styles = [
    espHomeStyles,
    dialogChromeStyles,
    quietCloseButtonStyles,
    dialogActionsRowStyles,
    dialogActionButtonStyles,
    changeBoardDialogStyles,
  ];

  open() {
    this._dialog.open = true;
  }

  close() {
    this._dialog.open = false;
  }

  protected render() {
    return html`
      <esphome-base-dialog
        ?open=${this._dialog.open}
        .label=${this._localize("device.change_board_title")}
        @request-close=${this._dialog.onRequestClose}
      >
        <p class="intro">
          ${this._localize("device.change_board_desc", {
            name: this.currentBoard?.name ?? "",
          })}
        </p>
        <div class="board-list">
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
