import { mdiArrowCollapseAll, mdiArrowExpandAll, mdiOpenInNew, mdiPlus } from "@mdi/js";
import { LitElement, html, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import memoizeOne from "memoize-one";
import type { BoardCatalogEntry } from "../../api/types/boards.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { loadMoreFooterStyles } from "../../styles/load-more-footer.js";
import { espHomeStyles } from "../../styles/shared.js";
import { boardImageUrl } from "../../util/board-image.js";
import { IntersectionController } from "../../util/intersection-controller.js";
import { renderMarkdown } from "../../util/markdown.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { renderLoadMoreFooter } from "../shared/load-more-footer.js";

import { wizardStepBoardStyles } from "./wizard-step-board.styles.js";

import "@home-assistant/webawesome/dist/components/badge/badge.js";
import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({
  "arrow-collapse-all": mdiArrowCollapseAll,
  "arrow-expand-all": mdiArrowExpandAll,
  "open-in-new": mdiOpenInNew,
  plus: mdiPlus,
});

/**
 * Scrolling board grid for ``<esphome-wizard-step-board>``: the featured
 * tile, the card grid, and an infinite-scroll sentinel that asks the parent
 * for the next page. Purely presentational — the parent owns the paged
 * fetch and feeds ``boards`` / ``hasMore``; this element emits ``load-more``
 * and ``add-board``.
 */
@customElement("esphome-wizard-step-board-list")
export class ESPHomeWizardStepBoardList extends LitElement {
  @property({ attribute: false })
  boards: BoardCatalogEntry[] = [];

  @property({ type: Boolean })
  loading = false;

  @property({ type: Boolean })
  loadingMore = false;

  @property({ type: Boolean })
  hasMore = false;

  @property({ type: Boolean })
  error = false;

  @property({ attribute: false })
  localize: LocalizeFunc = (key) => key;

  @state()
  private _expandedBoardId: string | null = null;

  @query(".sentinel")
  private _sentinel?: HTMLElement | null;

  private _intersection = new IntersectionController(this, () =>
    this.dispatchEvent(new CustomEvent("load-more"))
  );

  // Split the catalog into the single featured tile + the rest. Memoised on
  // the ``boards`` reference so the find + filter pair shares one walk per
  // page append.
  private _splitBoards = memoizeOne((boards: BoardCatalogEntry[]) => ({
    featured: boards.find((b) => b.featured),
    regular: boards.filter((b) => !b.featured),
  }));

  static styles = [espHomeStyles, wizardStepBoardStyles, loadMoreFooterStyles];

  protected render() {
    const { featured, regular } = this._splitBoards(this.boards);
    return html`
      <div class="boards-scroll">
        ${
          this.loading
            ? html`<p class="loading">${this.localize("wizard.loading_boards")}</p>`
            : this.boards.length === 0
              ? html`<p class="loading">
                  ${this.localize(
                    this.error ? "wizard.boards_load_error" : "wizard.no_boards_found"
                  )}
                </p>`
              : html`
                  ${
                    featured
                      ? html`
                          <p class="section-label">
                            ${this.localize("wizard.starter_kit")}
                          </p>
                          ${this._renderFeatured(featured)}
                        `
                      : nothing
                  }
                  ${
                    regular.length
                      ? html`
                          <p class="section-label">
                            ${this.localize("wizard.other_boards")}
                          </p>
                          <div class="boards-grid">
                            ${regular.map((board) =>
                              this._renderBoardCard(
                                board,
                                board.id === this._expandedBoardId
                              )
                            )}
                          </div>
                        `
                      : nothing
                  }
                  ${renderLoadMoreFooter({
                    loadingMore: this.loadingMore,
                    error: this.error,
                    hasMore: this.hasMore,
                    localize: this.localize,
                    loadingLabelKey: "wizard.loading_boards",
                    errorLabelKey: "wizard.boards_load_more_error",
                    onRetry: this._onRetry,
                    loadingClass: "loading",
                  })}
                `
        }
      </div>
    `;
  }

  protected updated() {
    // Observe against the viewport (null root), not the inner scroll box: on
    // mobile the board list isn't its own scroll container (the dialog body
    // scrolls as one), so a fixed root would never see the sentinel cross and
    // paging would stall after one page. IntersectionObserver still clips the
    // sentinel by the desktop scroll box, so this works in both layouts. The
    // 200px margin prefetches the next page before the sentinel is in view.
    //
    // Re-paging relies on each appended page overflowing the scroll container
    // so the sentinel leaves the viewport and re-crosses on the next scroll.
    // That always holds: a full page is far taller than the container, and the
    // only short page is the last one, which lands hasMore=false and removes
    // the sentinel. A short non-final page (which would keep the sentinel in
    // view and not re-fire) never occurs.
    this._intersection.observeIfPresent(this._sentinel, null, "200px");
  }

  private _renderFeatured(board: BoardCatalogEntry) {
    const imageUrl = boardImageUrl(board);
    return html`
      <div class="featured-card">
        <img class="featured-image" src=${imageUrl} alt=${board.name} loading="lazy" />
        <div class="featured-body">
          <h3 class="featured-title">${board.name}</h3>
          <p class="featured-desc">${renderMarkdown(board.description)}</p>
          <div class="tags">
            <wa-badge variant="neutral" pill style="font-size: var(--wa-font-size-s);"
              >${this._localizeTag(
                board.esphome.mcu || board.esphome.variant || board.esphome.platform
              )}</wa-badge
            >
            ${board.tags.map(
              (tag) =>
                html`<wa-badge
                  variant=${tag === "starter-kit" ? "success" : "brand"}
                  pill
                  style="font-size: var(--wa-font-size-s);"
                  >${this._localizeTag(tag)}</wa-badge
                >`
            )}
          </div>
          <div class="featured-footer">
            <a class="more-info" href=${board.docs_url} target="_blank" rel="noreferrer">
              ${this.localize("wizard.more_info")}
              <wa-icon library="mdi" name="open-in-new"></wa-icon>
            </a>
            <button class="select-board" type="button" @click=${() => this._onAdd(board)}>
              <wa-icon library="mdi" name="plus"></wa-icon>
              ${this.localize("wizard.add_board")}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  private _renderBoardCard(board: BoardCatalogEntry, expanded: boolean) {
    const imageUrl = boardImageUrl(board);
    return html`
      <article class="board-card ${expanded ? "board-card--expanded" : ""}">
        <div class="board-card-header">
          <img class="board-image" src=${imageUrl} alt=${board.name} loading="lazy" />
          <div class="board-card-header-text">
            <h3 class="board-title">${board.name}</h3>
          </div>
          <button
            class="expand-button"
            type="button"
            aria-pressed=${expanded}
            title=${this.localize("wizard.expand_board")}
            @click=${() => this._onToggleExpand(board)}
          >
            <wa-icon
              library="mdi"
              name=${expanded ? "arrow-collapse-all" : "arrow-expand-all"}
            ></wa-icon>
          </button>
        </div>

        <p class="board-description ${expanded ? "" : "board-description--clamp"}">
          ${renderMarkdown(board.description)}
        </p>

        <div class="tags">
          <wa-badge style="font-size: var(--wa-font-size-xs);" variant="neutral" pill
            >${this._localizeTag(
              board.esphome.mcu || board.esphome.variant || board.esphome.platform
            )}</wa-badge
          >
          ${board.tags.map(
            (tag) =>
              html`<wa-badge
                style="font-size: var(--wa-font-size-xs);"
                variant=${tag === "starter-kit" ? "success" : "brand"}
                pill
                >${this._localizeTag(tag)}</wa-badge
              >`
          )}
        </div>

        <div class="card-footer">
          <a class="more-info" href=${board.docs_url} target="_blank" rel="noreferrer">
            ${this.localize("wizard.more_info")}
            <wa-icon library="mdi" name="open-in-new"></wa-icon>
          </a>
          <button class="select-board" type="button" @click=${() => this._onAdd(board)}>
            <wa-icon library="mdi" name="plus"></wa-icon>
            ${this.localize("wizard.add_board")}
          </button>
        </div>
      </article>
    `;
  }

  private _onToggleExpand(board: BoardCatalogEntry) {
    this._expandedBoardId = this._expandedBoardId === board.id ? null : board.id;
  }

  private _onRetry = () => {
    // Same request the sentinel makes; the parent re-runs loadMore().
    this.dispatchEvent(new CustomEvent("load-more"));
  };

  private _localizeTag(tag: string): string {
    const key = `wizard.tag.${tag}`;
    const translated = this.localize(key);
    // If localize returns the key itself, show the raw tag instead
    return translated === key ? tag : translated;
  }

  private _onAdd(board: BoardCatalogEntry) {
    this.dispatchEvent(
      new CustomEvent("add-board", {
        detail: { board },
        bubbles: true,
        composed: true,
      })
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-wizard-step-board-list": ESPHomeWizardStepBoardList;
  }
}
