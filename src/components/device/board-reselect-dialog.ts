import { consume } from "@lit/context";
import { html, LitElement } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import type { ESPHomeAPI } from "../../api/index.js";
import type { PagedBoardsResponse, SlimBoard } from "../../api/types/boards.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { apiContext, localizeContext } from "../../context/index.js";
import { chipNameToVariant } from "../../util/chip-variant.js";
import { notifyError, notifySuccess } from "../../util/notify.js";
import { PagedListController } from "../../util/paged-list-controller.js";
import { readPlatformBoard } from "../../util/yaml-board.js";
import type { ESPHomeChangeBoardDialog } from "./change-board-dialog.js";

import "./change-board-dialog.js";

const PAGE_SIZE = 50;

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
 * `esp32.variant:` — boards of that same variant, server-paged with
 * infinite scroll. The pick updates only the sidecar `board_id` via
 * `devices/update` — the YAML is already the source of truth. Emits
 * `board-changed` on success.
 */
@customElement("esphome-board-reselect-dialog")
export class ESPHomeBoardReselectDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: apiContext })
  private _api!: ESPHomeAPI;

  /** Exact `board:`-string matches; null means the paged variant listing. */
  @state()
  private _exactBoards: SlimBoard[] | null = null;

  @state()
  private _description = "";

  @query("esphome-change-board-dialog")
  private _dialog!: ESPHomeChangeBoardDialog;

  private readonly _list = new PagedListController<SlimBoard>(this, PAGE_SIZE);

  private _configuration = "";

  async open(opts: BoardReselectOpenOptions): Promise<void> {
    try {
      const yaml = opts.yaml ?? (await this._api.getConfig(opts.configuration));
      const parsed = readPlatformBoard(yaml);
      const label = parsed?.board ?? parsed?.variant ?? parsed?.platform ?? "";
      if (!(await this._loadCandidates(parsed))) {
        notifyError(this._localize("device.board_reselect_none", { board: label }));
        return;
      }
      this._configuration = opts.configuration;
      this._description = this._localize("device.board_reselect_desc", { board: label });
      await this.updateComplete;
      this._dialog.open();
    } catch (err) {
      console.error("Failed to open board reselect:", err);
      notifyError(this._localize("device.change_board_error"));
    }
  }

  protected render() {
    const paged = this._exactBoards === null;
    return html`
      <esphome-change-board-dialog
        .boards=${this._exactBoards ?? this._list.items}
        .heading=${this._localize("device.board_reselect_title")}
        .description=${this._description}
        ?hasMore=${paged && this._list.hasMore}
        ?loadingMore=${paged && this._list.loadingMore}
        ?loadError=${paged && this._list.hasError && this._list.items.length > 0}
        @load-more=${this._onLoadMore}
        @select-board=${this._onSelectBoard}
      ></esphome-change-board-dialog>
    `;
  }

  /** Resolve candidates; true when any exist (state is then populated). */
  private async _loadCandidates(
    parsed: ReturnType<typeof readPlatformBoard>
  ): Promise<boolean> {
    if (parsed?.board) {
      const board = parsed.board.toLowerCase();
      const { boards } = await this._api.getBoards({
        query: parsed.board,
        limit: 100,
      });
      const match = boards.find(
        (b) =>
          b.esphome.board.toLowerCase() === board &&
          b.esphome.platform === parsed.platform
      );
      if (match) {
        // The compatible-boards command returns the complete same-target
        // set in one page — the query search alone would cap the list.
        this._exactBoards = await this._api.getCompatibleBoards(match.id);
        return true;
      }
    }
    // A variant-only YAML (`esp32.variant:` with no `board:`, or a board
    // string the catalog doesn't carry) still pins the chip — every board
    // of that variant is compatible. Anything broader is not offered.
    if (parsed?.platform === "esp32" && parsed.variant) {
      const variant = chipNameToVariant(parsed.variant);
      const fetchPage = async (offset: number, limit: number) => {
        const page = await this._api.getBoards({
          platform: "esp32",
          variant,
          offset,
          limit,
        });
        return { items: page.boards, total: page.total };
      };
      // Probe page 0 up front so the none-found case toasts instead of
      // opening an empty dialog; the reset serves it without a refetch.
      const probe = await this._api.getBoards({
        platform: "esp32",
        variant,
        limit: PAGE_SIZE,
      });
      if (probe.boards.length === 0) return false;
      let seeded: PagedBoardsResponse | null = probe;
      this._exactBoards = null;
      this._list.reset(async (offset, limit) => {
        if (offset === 0 && seeded) {
          const first = seeded;
          seeded = null;
          return { items: first.boards, total: first.total };
        }
        return fetchPage(offset, limit);
      });
      return true;
    }
    return false;
  }

  private _onLoadMore = () => {
    this._list.loadMore();
  };

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
