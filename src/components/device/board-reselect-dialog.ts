import { consume } from "@lit/context";
import { html, LitElement } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import type { ESPHomeAPI } from "../../api/index.js";
import type { SlimBoard } from "../../api/types/boards.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { apiContext, localizeContext } from "../../context/index.js";
import { chipNameToVariant } from "../../util/chip-variant.js";
import { notifyError, notifySuccess } from "../../util/notify.js";
import { readPlatformBoard } from "../../util/yaml-board.js";
import type { ESPHomeChangeBoardDialog } from "./change-board-dialog.js";

import "./change-board-dialog.js";

export interface BoardReselectOpenOptions {
  configuration: string;
  /** Saved YAML when the caller already holds it; fetched otherwise. */
  yaml?: string;
}

/**
 * Reselect a device's stored board to match its YAML.
 *
 * Candidates are limited to compatible boards: exact matches on the
 * YAML's `board:` PlatformIO string, or — when the YAML sets only an
 * `esp32.variant:` — boards of that same variant. The pick updates only
 * the sidecar `board_id` via `devices/update` — the YAML is already the
 * source of truth. Emits `board-changed` on success.
 */
@customElement("esphome-board-reselect-dialog")
export class ESPHomeBoardReselectDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: apiContext })
  private _api!: ESPHomeAPI;

  @state()
  private _boards: SlimBoard[] = [];

  @state()
  private _description = "";

  @query("esphome-change-board-dialog")
  private _dialog!: ESPHomeChangeBoardDialog;

  private _configuration = "";

  async open(opts: BoardReselectOpenOptions): Promise<void> {
    try {
      const yaml = opts.yaml ?? (await this._api.getConfig(opts.configuration));
      const parsed = readPlatformBoard(yaml);
      const boards = await this._findCandidates(parsed);
      const label = parsed?.board ?? parsed?.variant ?? parsed?.platform ?? "";
      if (boards.length === 0) {
        notifyError(this._localize("device.board_reselect_none", { board: label }));
        return;
      }
      this._configuration = opts.configuration;
      this._boards = boards;
      this._description = this._localize("device.board_reselect_desc", { board: label });
      await this.updateComplete;
      this._dialog.open();
    } catch (err) {
      console.error("Failed to open board reselect:", err);
      notifyError(this._localize("device.change_board_error"));
    }
  }

  protected render() {
    return html`
      <esphome-change-board-dialog
        .boards=${this._boards}
        .heading=${this._localize("device.board_reselect_title")}
        .description=${this._description}
        @select-board=${this._onSelectBoard}
      ></esphome-change-board-dialog>
    `;
  }

  private async _findCandidates(
    parsed: ReturnType<typeof readPlatformBoard>
  ): Promise<SlimBoard[]> {
    if (parsed?.board) {
      const board = parsed.board.toLowerCase();
      const { boards } = await this._api.getBoards({ query: parsed.board, limit: 50 });
      const exact = boards.filter(
        (b) =>
          b.esphome.board.toLowerCase() === board &&
          b.esphome.platform === parsed.platform
      );
      if (exact.length > 0) return exact;
    }
    // A variant-only YAML (`esp32.variant:` with no `board:`, or a board
    // string the catalog doesn't carry) still pins the chip — every board
    // of that variant is compatible. Anything broader is not offered.
    if (parsed?.platform === "esp32" && parsed.variant) {
      const { boards } = await this._api.getBoards({
        platform: "esp32",
        variant: chipNameToVariant(parsed.variant),
        limit: 50,
      });
      return boards;
    }
    return [];
  }

  private _onSelectBoard = async (e: CustomEvent<{ boardId: string }>) => {
    // Keep the pick out of the page-level `change-board` machinery —
    // this dialog owns the apply.
    e.stopPropagation();
    const configuration = this._configuration;
    if (!configuration) return;
    try {
      await this._api.updateDevice({ configuration, board_id: e.detail.boardId });
      notifySuccess(this._localize("device.change_board_success"));
      this.dispatchEvent(
        new CustomEvent<{ configuration: string; boardId: string }>("board-changed", {
          detail: { configuration, boardId: e.detail.boardId },
          bubbles: true,
          composed: true,
        })
      );
    } catch (err) {
      console.error("Failed to change board:", err);
      notifyError(this._localize("device.change_board_error"));
    }
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-board-reselect-dialog": ESPHomeBoardReselectDialog;
  }
}
