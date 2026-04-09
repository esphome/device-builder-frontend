import { consume } from "@lit/context";
import {
  mdiArrowCollapseAll,
  mdiArrowExpandAll,
  mdiChevronDown,
  mdiOpenInNew,
  mdiPlus,
} from "@mdi/js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { BoardCatalogEntry } from "../../api/types.js";
import type { ESPHomeAPI } from "../../api/index.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { localizeContext, apiContext } from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import { debounce } from "../../util/debounce.js";
import { registerMdiIcons } from "../../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/badge/badge.js";
import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/input/input.js";

registerMdiIcons({
  "arrow-collapse-all": mdiArrowCollapseAll,
  "arrow-expand-all": mdiArrowExpandAll,
  "chevron-down": mdiChevronDown,
  "open-in-new": mdiOpenInNew,
  plus: mdiPlus,
});

@customElement("esphome-wizard-step-board")
export class ESPHomeWizardStepBoard extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: apiContext })
  private _api!: ESPHomeAPI;

  @state()
  private _boards: BoardCatalogEntry[] = [];

  @state()
  private _loading = true;

  @state()
  private _search = "";

  @state()
  private _expandedBoardId: string | null = null;

  private _debouncedSearch = debounce(() => this._fetchBoards(), 300);

  connectedCallback() {
    super.connectedCallback();
    this._fetchBoards();
  }

  private async _fetchBoards() {
    this._loading = true;
    try {
      const query = this._search.trim() || undefined;
      const response = await this._api.getBoards({ query, limit: 50 });
      this._boards = response.boards;
    } catch (e) {
      console.error("Failed to load board catalog:", e);
    } finally {
      this._loading = false;
    }
  }

  static styles = [
    espHomeStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-m);
      }

      wa-input {
        width: 100%;
      }

      .helper-row {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wa-space-m);
        font-size: var(--wa-font-size-xs);
        margin-top: calc(-1 * var(--wa-space-xs));
      }

      .helper-link {
        border: none;
        padding: 0;
        background: none;
        color: var(--esphome-primary);
        cursor: pointer;
        text-decoration: underline;
        font: inherit;
      }

      .helper-link:hover {
        text-decoration: none;
      }

      .helper-link--bold {
        font-weight: var(--wa-font-weight-bold);
      }

      .featured-card {
        display: flex;
        gap: var(--wa-space-l);
        padding: var(--wa-space-m);
        border-radius: var(--wa-border-radius-l);
        border: var(--wa-border-width-m) solid var(--wa-color-surface-border);
      }

      .featured-image {
        width: 120px;
        height: 80px;
        object-fit: contain;
        flex-shrink: 0;
        border-radius: var(--wa-border-radius-m);
        background: var(--wa-color-surface-default);
        padding: var(--wa-space-xs);
        box-sizing: border-box;
      }

      .featured-body {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-xs);
        min-width: 0;
      }

      .featured-title {
        margin: 0;
        font-size: var(--wa-font-size-m);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-normal);
      }

      .featured-desc {
        margin: 0;
        font-size: var(--wa-font-size-s);
        color: var(--wa-color-text-quiet);
      }

      .featured-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-top: var(--wa-space-xs);
      }

      .section-label {
        font-size: var(--wa-font-size-xs);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-subtle);
        text-transform: uppercase;
        letter-spacing: 0.06em;
        margin: 0;
      }

      .boards-scroll {
        max-height: 320px;
        overflow-y: auto;
        padding-right: var(--wa-space-2xs);
      }

      .boards-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: var(--wa-space-s);
      }

      .board-card {
        position: relative;
        border-radius: var(--wa-border-radius-l);
        background: var(--wa-color-surface-default);
        padding: var(--wa-space-m);
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-s);
        transition: border-color var(--wa-transition-normal) var(--wa-transition-easing);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
      }

      .board-card:hover {
        border-color: var(--esphome-primary);
      }

      .board-card--expanded {
        grid-column: 1 / -1;
      }

      .board-card-header {
        display: flex;
        align-items: flex-start;
        gap: var(--wa-space-s);
      }

      .board-image {
        width: 48px;
        height: 36px;
        object-fit: contain;
        border-radius: var(--wa-border-radius-s);
        background: var(--wa-color-surface-subtle);
        flex-shrink: 0;
        padding: 3px;
        box-sizing: border-box;
      }

      .board-card-header-text {
        flex: 1;
        min-width: 0;
      }

      .board-title {
        margin: 0;
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-normal);
        line-height: 1.3;
      }

      .expand-button {
        border: none;
        background: none;
        cursor: pointer;
        padding: 2px;
        border-radius: 4px;
        display: inline-flex;
        align-items: center;
        flex-shrink: 0;
        margin-top: -2px;
        color: var(--esphome-primary);
        font-size: 18px;
      }

      .expand-button wa-icon {
        transition: transform var(--wa-transition-normal) var(--wa-transition-easing);
      }

      .board-description {
        margin: 0;
        font-size: var(--wa-font-size-xs);
        color: var(--wa-color-text-quiet);
        line-height: 1.5;
      }

      .board-description--clamp {
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }

      .tags {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wa-space-2xs);
      }

      .card-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wa-space-s);
        margin-top: 20px;
      }

      .more-info {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        font-size: var(--wa-font-size-xs);
        color: var(--esphome-primary);
        text-decoration: none;
      }

      .more-info:hover {
        text-decoration: underline;
      }

      .more-info wa-icon {
        font-size: 13px;
      }

      .select-board {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
        color: var(--esphome-primary);
        cursor: pointer;
      }

      .loading {
        color: var(--wa-color-text-quiet);
        font-size: var(--wa-font-size-s);
        text-align: center;
        padding: var(--wa-space-xl);
      }
    `,
  ];

  protected render() {
    if (this._loading) {
      return html`<p class="loading">${this._localize("wizard.loading_boards")}</p>`;
    }

    const featured = this._boards.find((b) => b.featured);
    const regular = this._boards.filter((b) => !b.featured);

    return html`
      <wa-input
        type="search"
        .value=${this._search}
        @input=${this._onSearchInput}
        placeholder=${this._localize("wizard.search_boards_placeholder")}
      ></wa-input>

      <div class="helper-row">
        <button class="helper-link" type="button">
          ${this._localize("wizard.dont_know_board")}
        </button>
        <button class="helper-link helper-link--bold" type="button">
          ${this._localize("wizard.connect_your_board")}
        </button>
      </div>

      ${featured
        ? html`
            <p class="section-label">${this._localize("wizard.starter_kit")}</p>
            ${this._renderFeatured(featured)}
          `
        : nothing}
      ${regular.length
        ? html`
            <p class="section-label">${this._localize("wizard.other_boards")}</p>
            <div class="boards-scroll">
              <div class="boards-grid">
                ${regular.map((board) =>
                  this._renderBoardCard(board, board.id === this._expandedBoardId)
                )}
              </div>
            </div>
          `
        : nothing}
    `;
  }

  private _renderFeatured(board: BoardCatalogEntry) {
    const imageUrl = board.images.length > 0 ? board.images[0] : "/assets/board/apollo.svg";
    return html`
      <div class="featured-card">
        <img class="featured-image" src=${imageUrl} alt=${board.name} />
        <div class="featured-body">
          <h3 class="featured-title">${board.name}</h3>
          <p class="featured-desc">${board.description}</p>
          <div class="tags">
            ${board.tags.map(
              (tag) =>
                html`<wa-badge
                  variant=${tag === "starter-kit" ? "success" : "brand"}
                  pill
                  style="font-size: var(--wa-font-size-s);"
                  >${this._localize(`wizard.tag.${tag}`)}</wa-badge
                >`
            )}
          </div>
          <div class="featured-footer">
            <a class="more-info" href=${board.docs_url} target="_blank" rel="noreferrer">
              ${this._localize("wizard.more_info")}
              <wa-icon library="mdi" name="open-in-new"></wa-icon>
            </a>
            <div class="select-board" @click=${() => this._onAdd(board)}>
              <wa-icon library="mdi" name="plus"></wa-icon>
              ${this._localize("wizard.add_board")}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private _renderBoardCard(board: BoardCatalogEntry, expanded: boolean) {
    const imageUrl = board.images.length > 0 ? board.images[0] : "/assets/board/default.svg";
    return html`
      <article class="board-card ${expanded ? "board-card--expanded" : ""}">
        <div class="board-card-header">
          <img class="board-image" src=${imageUrl} alt=${board.name} />
          <div class="board-card-header-text">
            <h3 class="board-title">${board.name}</h3>
          </div>
          <button
            class="expand-button"
            type="button"
            aria-pressed=${expanded}
            title=${this._localize("wizard.expand_board")}
            @click=${() => this._onToggleExpand(board)}
          >
            <wa-icon
              library="mdi"
              name=${expanded ? "arrow-collapse-all" : "arrow-expand-all"}
            ></wa-icon>
          </button>
        </div>

        <p class="board-description ${expanded ? "" : "board-description--clamp"}">
          ${board.description}
        </p>

        <div class="tags">
          ${board.tags.map(
            (tag) =>
              html`<wa-badge
                style="font-size: var(--wa-font-size-xs);"
                variant=${tag === "starter-kit" ? "success" : "brand"}
                pill
                >${this._localize(`wizard.tag.${tag}`)}</wa-badge
              >`
          )}
        </div>

        <div class="card-footer">
          <a class="more-info" href=${board.docs_url} target="_blank" rel="noreferrer">
            ${this._localize("wizard.more_info")}
            <wa-icon library="mdi" name="open-in-new"></wa-icon>
          </a>
          <div class="select-board" @click=${() => this._onAdd(board)}>
            <wa-icon library="mdi" name="plus"></wa-icon>
            ${this._localize("wizard.add_board")}
          </div>
        </div>
      </article>
    `;
  }

  private _onSearchInput(ev: Event) {
    this._search = (ev.target as HTMLInputElement).value;
    this._debouncedSearch();
  }

  private _onToggleExpand(board: BoardCatalogEntry) {
    this._expandedBoardId = this._expandedBoardId === board.id ? null : board.id;
  }

  private _onAdd(board: BoardCatalogEntry) {
    this.dispatchEvent(
      new CustomEvent("next-step", {
        detail: { step: "setup", board },
        bubbles: true,
        composed: true,
      })
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-wizard-step-board": ESPHomeWizardStepBoard;
  }
}
