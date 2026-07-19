import { consume } from "@lit/context";
import { html, LitElement } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import memoizeOne from "memoize-one";
import type { ESPHomeAPI } from "../../api/index.js";
import type { SlimBoard } from "../../api/types/boards.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { apiContext, localizeContext } from "../../context/index.js";
import { applyBoardChange } from "../../util/board-change.js";
import { chipNameToVariant } from "../../util/chip-variant.js";
import { canonicalComponentKey } from "../../util/component-presence.js";
import { debounce } from "../../util/debounce.js";
import { notifyError } from "../../util/notify.js";
import { PagedListController } from "../../util/paged-list-controller.js";
import { readPlatformBoard, type YamlPlatformBoard } from "../../util/yaml-board.js";
import type { ESPHomeChangeBoardDialog } from "./change-board-dialog.js";
import { navItemMatches } from "./navigator-search-match.js";

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

  @state()
  private _search = "";

  @query("esphome-change-board-dialog")
  private _dialog!: ESPHomeChangeBoardDialog;

  private readonly _list = new PagedListController<SlimBoard>(this, PAGE_SIZE);

  private _configuration = "";

  /** Variant of the paged listing; the search re-query needs it. */
  private _variant: string | null = null;

  /** Latest raw input value, committed to `_search` by the debounce. */
  private _pendingSearch = "";

  /** Resolve candidates and show the picker; false when nothing opened
   *  (no candidates, or a fetch failed) so callers can retry later. */
  async open(opts: BoardReselectOpenOptions): Promise<boolean> {
    try {
      const yaml = opts.yaml ?? (await this._api.getConfig(opts.configuration));
      const parsed = readPlatformBoard(yaml);
      // Only a board or variant is matchable; a bare platform block gets
      // the no-platform toast below.
      const label = parsed?.board ?? parsed?.variant ?? "";
      this._search = "";
      this._pendingSearch = "";
      if (!(await this._loadCandidates(parsed))) {
        notifyError(
          label
            ? this._localize("device.board_reselect_none", { board: label })
            : this._localize("device.board_reselect_no_platform")
        );
        return false;
      }
      this._configuration = opts.configuration;
      this._description = this._localize("device.board_reselect_desc", { board: label });
      await this.updateComplete;
      this._dialog.open();
      return true;
    } catch (err) {
      console.error("Failed to open board reselect:", err);
      notifyError(this._localize("device.change_board_error"));
      return false;
    }
  }

  protected render() {
    const paged = this._exactBoards === null;
    return html`
      <esphome-change-board-dialog
        .boards=${this._filteredBoards()}
        .heading=${this._localize("device.board_reselect_title")}
        .description=${this._description}
        searchable
        ?hasMore=${paged && this._list.hasMore}
        ?loadingMore=${paged && (this._list.loading || this._list.loadingMore)}
        ?loadError=${paged && this._list.hasError}
        @load-more=${this._onLoadMore}
        @search-changed=${this._onSearchChanged}
        @select-board=${this._onSelectBoard}
      ></esphome-change-board-dialog>
    `;
  }

  /** Exact matches filter client-side (the set is complete); the paged
   *  listing re-queries the server instead. Memoized so the `.boards`
   *  binding keeps a stable identity across unrelated renders. */
  private _filterExact = memoizeOne((boards: SlimBoard[], search: string) => {
    if (!search) return boards;
    return boards.filter((b) => navItemMatches(search, b.name, b.manufacturer, b.id));
  });

  private _filteredBoards(): SlimBoard[] {
    if (this._exactBoards === null) return this._list.items;
    return this._filterExact(this._exactBoards, this._search);
  }

  /** Resolve candidates; true when any exist (state is then populated). */
  private async _loadCandidates(parsed: YamlPlatformBoard | null): Promise<boolean> {
    if (parsed?.board) {
      const board = parsed.board.toLowerCase();
      const { boards } = await this._api.getBoards({
        query: parsed.board,
        limit: 100,
      });
      const match = boards.find(
        (b) =>
          b.esphome.board.toLowerCase() === board &&
          canonicalComponentKey(b.esphome.platform) === parsed.platform
      );
      if (match) {
        // The compatible-boards command returns the complete same-target
        // set in one page — the query search alone would cap the list. An
        // anomalous empty set falls through to the variant listing.
        const compatible = await this._api.getCompatibleBoards(match.id);
        if (compatible.length > 0) {
          this._exactBoards = compatible;
          return true;
        }
      }
    }
    // A variant-only YAML (`esp32.variant:` with no `board:`, or a board
    // string the catalog doesn't carry) still pins the chip — every board
    // of that variant is compatible. Anything broader is not offered.
    if (parsed?.platform === "esp32" && parsed.variant) {
      this._variant = chipNameToVariant(parsed.variant);
      // Probe page 0 up front so the none-found case toasts instead of
      // opening an empty dialog; the reset serves it without a refetch
      // (offset 0 is only ever the reset's own first fetch).
      const probe = await this._fetchVariantPage(0, PAGE_SIZE);
      if (probe.items.length === 0) return false;
      this._exactBoards = null;
      this._list.reset((offset, limit) =>
        offset === 0 ? Promise.resolve(probe) : this._fetchVariantPage(offset, limit)
      );
      return true;
    }
    return false;
  }

  private _fetchVariantPage = async (offset: number, limit: number) => {
    const page = await this._api.getBoards({
      platform: "esp32",
      variant: this._variant ?? undefined,
      ...(this._search ? { query: this._search } : {}),
      offset,
      limit,
    });
    return { items: page.boards, total: page.total };
  };

  private _onLoadMore = () => {
    this._list.loadMore();
  };

  private _applySearch = debounce(() => {
    const value = this._pendingSearch.trim();
    if (value === this._search) return;
    this._search = value;
    // Exact mode filters in render; the paged listing re-queries.
    if (this._exactBoards === null) this._list.reset(this._fetchVariantPage);
  }, 300);

  private _onSearchChanged = (e: CustomEvent<{ value: string }>) => {
    this._pendingSearch = e.detail.value;
    this._applySearch();
  };

  private _onSelectBoard = async (e: CustomEvent<{ boardId: string }>) => {
    // Keep the pick out of the page-level `change-board` machinery —
    // this dialog owns the apply.
    e.stopPropagation();
    const configuration = this._configuration;
    if (!configuration) return;
    if (
      await applyBoardChange(this._api, this._localize, configuration, e.detail.boardId)
    ) {
      this.dispatchEvent(
        new CustomEvent<{ configuration: string; boardId: string }>("board-changed", {
          detail: { configuration, boardId: e.detail.boardId },
          bubbles: true,
          composed: true,
        })
      );
    }
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-board-reselect-dialog": ESPHomeBoardReselectDialog;
  }
}
