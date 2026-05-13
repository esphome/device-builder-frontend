import { consume } from "@lit/context";
import {
  mdiArrowCollapseAll,
  mdiArrowExpandAll,
  mdiChevronDown,
  mdiOpenInNew,
  mdiPlus,
  mdiUsbPort,
} from "@mdi/js";
import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { APIError } from "../../api/api-error.js";
import type { ESPHomeAPI } from "../../api/index.js";
import type { BoardCatalogEntry, SerialPort } from "../../api/types.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { apiContext, localizeContext } from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import {
  WIZARD_BOARD_PLATFORMS,
  chipNameToFilterLabel,
} from "./wizard-step-board-platforms.js";
import { withBase } from "../../util/base-path.js";
import { debounce } from "../../util/debounce.js";
import { detectEnvironment, type DeploymentEnvironment } from "../../util/environment.js";
import { renderMarkdown } from "../../util/markdown.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import {
  detectChip,
  disconnect,
  isWebSerialSupported,
  readDeviceManifest,
} from "../../util/web-serial.js";

import { inputStyles } from "../../styles/inputs.js";

import "@home-assistant/webawesome/dist/components/badge/badge.js";
import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "./wizard-step-board-port-select.js";

registerMdiIcons({
  "arrow-collapse-all": mdiArrowCollapseAll,
  "arrow-expand-all": mdiArrowExpandAll,
  "chevron-down": mdiChevronDown,
  "open-in-new": mdiOpenInNew,
  plus: mdiPlus,
  "usb-port": mdiUsbPort,
});

@customElement("esphome-wizard-step-board")
export class ESPHomeWizardStepBoard extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: apiContext })
  private _api!: ESPHomeAPI;

  /** Platform-filter chip label to apply on first mount (e.g.
   *  ``"ESP32-C6"``). Set by the parent dialog when a chip family
   *  is known up front — the serial-detect flow uses this to land
   *  the user on a picker already narrowed to their hardware. */
  @property({ attribute: false })
  presetFilterLabel: string | null = null;

  @state()
  private _boards: BoardCatalogEntry[] = [];

  @state()
  private _loading = true;

  @state()
  private _initialLoad = true;

  @state()
  private _search = "";

  @state()
  private _expandedBoardId: string | null = null;

  @state()
  private _selectedFilter = "";

  /** True while the active filter was applied by chip detection
   *  (preset from the parent, or set by the Connect-your-board
   *  button after a chip was identified) rather than a manual chip
   *  click. In detection mode the picker drops the filter chips,
   *  the Connect-your-board button, and the "don't know" link —
   *  the user has already engaged with detection and just needs
   *  to pick a specific board for the chip we found. Reset by
   *  manual filter clicks and by the "Show all boards" escape. */
  @state()
  private _filterFromDetection = false;

  /** Which inner view the step is rendering: the boards picker, or
   *  the server-side serial-port selector reached when the user
   *  clicks "Connect your board" without WebSerial available. */
  @state()
  private _view: "boards" | "select-port" = "boards";

  @state()
  private _serverPorts: SerialPort[] = [];

  @state()
  private _loadingServerPorts = false;

  @state()
  private _detectingChip = false;

  @state()
  private _detectError = "";

  private _debouncedSearch = debounce(() => this._fetchBoards(), 300);

  private static readonly PLATFORMS = WIZARD_BOARD_PLATFORMS;

  connectedCallback() {
    super.connectedCallback();
    // Lit usually sets ``.presetFilterLabel`` before connectedCallback
    // fires (property bindings are applied during element upgrade), so
    // this path handles the common case. ``willUpdate`` below covers
    // the parent-updates-after-mount case where the element is reused
    // and the preset arrives later.
    if (this.presetFilterLabel) {
      this._selectedFilter = this.presetFilterLabel;
      this._filterFromDetection = true;
    }
    this._fetchBoards();
  }

  willUpdate(changed: PropertyValues<this>) {
    super.willUpdate(changed);
    if (
      changed.has("presetFilterLabel") &&
      this.presetFilterLabel &&
      !this._selectedFilter
    ) {
      this._selectedFilter = this.presetFilterLabel;
      this._filterFromDetection = true;
      void this._fetchBoards();
    }
  }

  private async _fetchBoards() {
    this._loading = true;
    try {
      const query = this._search.trim() || undefined;
      const filter = ESPHomeWizardStepBoard.PLATFORMS.find(
        (p) => p.label === this._selectedFilter
      );
      const platform = filter?.platform || undefined;
      const variant = filter?.variant || undefined;
      const response = await this._api.getBoards({ query, platform, variant, limit: 50 });
      this._boards = response.boards;
    } catch (e) {
      console.error("Failed to load board catalog:", e);
    } finally {
      this._loading = false;
      this._initialLoad = false;
    }
  }

  static styles = [
    espHomeStyles,
    inputStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-m);
      }

      .helper-row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wa-space-s);
        font-size: var(--wa-font-size-xs);
        margin-top: calc(-1 * var(--wa-space-2xs));
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

      .connect-board-btn {
        display: inline-flex;
        align-items: center;
        gap: var(--wa-space-xs);
        padding: var(--wa-space-xs) var(--wa-space-m);
        font-family: inherit;
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
        color: var(--esphome-primary);
        background: var(--esphome-primary-light);
        border: none;
        border-radius: var(--wa-border-radius-m);
        cursor: pointer;
        transition: background 0.12s;
      }

      .connect-board-btn:hover:not(:disabled) {
        background: color-mix(in srgb, var(--esphome-primary-light), black 5%);
      }

      .connect-board-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .connect-board-btn wa-icon {
        font-size: 16px;
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
        padding: var(--wa-space-s) 0;
        margin: 0;
      }

      .boards-scroll {
        height: 500px;
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
        margin-top: auto;
        padding-top: var(--wa-space-m);
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

      .platform-filters {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }

      .detection-banner {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--wa-space-s);
        padding: var(--wa-space-s) var(--wa-space-m);
        border-radius: var(--wa-border-radius-m);
        background: color-mix(in srgb, var(--esphome-primary), transparent 92%);
        border: var(--wa-border-width-s) solid
          color-mix(in srgb, var(--esphome-primary), transparent 70%);
        color: var(--wa-color-text);
        font-size: var(--wa-font-size-s);
      }

      .platform-chip {
        display: inline-flex;
        align-items: center;
        padding: 4px 12px;
        border-radius: 999px;
        font-size: var(--wa-font-size-2xs);
        font-weight: var(--wa-font-weight-bold);
        font-family: inherit;
        cursor: pointer;
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        background: transparent;
        color: var(--wa-color-text-quiet);
        transition: all 0.12s;
      }

      .platform-chip:hover {
        border-color: var(--esphome-primary);
        color: var(--esphome-primary);
      }

      .platform-chip--active {
        background: color-mix(in srgb, var(--esphome-primary), transparent 88%);
        border-color: var(--esphome-primary);
        color: var(--esphome-primary);
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
    if (this._view === "select-port") {
      return html`
        <esphome-wizard-step-board-port-select
          .environment=${this._environment}
          .ports=${this._serverPorts}
          .loading=${this._loadingServerPorts}
          .detecting=${this._detectingChip}
          .errorMessage=${this._detectError}
          @select-port=${this._onServerPortSelected}
          @back=${this._onBackFromPortSelect}
        ></esphome-wizard-step-board-port-select>
      `;
    }

    if (this._initialLoad && this._loading) {
      return html`<p class="loading">${this._localize("wizard.loading_boards")}</p>`;
    }

    const featured = this._boards.find((b) => b.featured);
    const regular = this._boards.filter((b) => !b.featured);

    return html`
      <input
        type="search"
        autocomplete="off"
        .value=${this._search}
        @input=${this._onSearchInput}
        placeholder=${this._localize("wizard.search_boards_placeholder")}
      />

      ${this._filterFromDetection
        ? html`
            <div class="detection-banner" role="status">
              <span>
                ${this._localize("wizard.detected_chip_family", {
                  family: this._selectedFilter,
                })}
              </span>
              <button
                class="helper-link"
                type="button"
                @click=${this._exitDetectionMode}
              >
                ${this._localize("wizard.show_all_boards")}
              </button>
            </div>
          `
        : html`
            <div class="platform-filters">
              ${ESPHomeWizardStepBoard.PLATFORMS.map(
                (p) =>
                  html`<button
                    class="platform-chip ${this._selectedFilter === p.label
                      ? "platform-chip--active"
                      : ""}"
                    @click=${() => this._onPlatformFilter(p.label)}
                  >
                    ${p.label}
                  </button>`
              )}
            </div>

            <div class="helper-row">
              <button
                class="connect-board-btn"
                type="button"
                @click=${this._connectBoard}
              >
                <wa-icon library="mdi" name="usb-port"></wa-icon>
                ${this._localize("wizard.connect_your_board")}
              </button>
              <button class="helper-link" type="button">
                ${this._localize("wizard.dont_know_board")}
              </button>
            </div>
          `}

      <div class="boards-scroll">
        ${this._loading
          ? html`<p class="loading">${this._localize("wizard.loading_boards")}</p>`
          : this._boards.length === 0
            ? html`<p class="loading">${this._localize("wizard.no_boards_found")}</p>`
            : html`
                ${featured
                  ? html`
                      <p class="section-label">${this._localize("wizard.starter_kit")}</p>
                      ${this._renderFeatured(featured)}
                    `
                  : nothing}
                ${regular.length
                  ? html`
                      <p class="section-label">
                        ${this._localize("wizard.other_boards")}
                      </p>
                      <div class="boards-grid">
                        ${regular.map((board) =>
                          this._renderBoardCard(board, board.id === this._expandedBoardId)
                        )}
                      </div>
                    `
                  : nothing}
              `}
      </div>
    `;
  }

  private _renderFeatured(board: BoardCatalogEntry) {
    const imageUrl =
      board.images.length > 0 ? board.images[0] : withBase("/assets/board/default.svg");
    return html`
      <div class="featured-card">
        <img class="featured-image" src=${imageUrl} alt=${board.name} />
        <div class="featured-body">
          <h3 class="featured-title">${board.name}</h3>
          <p class="featured-desc">${renderMarkdown(board.description)}</p>
          <div class="tags">
            <wa-badge variant="neutral" pill style="font-size: var(--wa-font-size-s);"
              >${this._localizeTag(
                board.esphome.variant || board.esphome.platform
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
    const imageUrl =
      board.images.length > 0 ? board.images[0] : withBase("/assets/board/default.svg");
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
          ${renderMarkdown(board.description)}
        </p>

        <div class="tags">
          <wa-badge style="font-size: var(--wa-font-size-xs);" variant="neutral" pill
            >${this._localizeTag(
              board.esphome.variant || board.esphome.platform
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

  private _onPlatformFilter(label: string) {
    this._selectedFilter = this._selectedFilter === label ? "" : label;
    // Manual filter click takes the user out of detection mode —
    // they've decided to browse, possibly narrower or wider than
    // the chip they plugged in.
    this._filterFromDetection = false;
    this._fetchBoards();
  }

  private _localizeTag(tag: string): string {
    const key = `wizard.tag.${tag}`;
    const translated = this._localize(key);
    // If localize returns the key itself, show the raw tag instead
    return translated === key ? tag : translated;
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

  private get _environment(): DeploymentEnvironment {
    return detectEnvironment(this._api);
  }

  /**
   * "Connect your board" click — picks the right transport for
   * the current browser. WebSerial is preferred when available
   * (no backend round-trip); otherwise we fall back to the
   * backend's enumerated serial ports, which works in browsers
   * without WebSerial (Safari, Firefox, iOS) and in setups where
   * the user reaches the dashboard from a different machine than
   * the one the board is plugged into.
   */
  private _connectBoard = () => {
    if (isWebSerialSupported()) {
      void this._connectViaWebSerial();
      return;
    }
    void this._openServerPortPicker();
  };

  private async _connectViaWebSerial() {
    try {
      const detected = await detectChip();
      // e.g. "ESP32-S3 (QFN56) (revision v0.2)"
      const chipName = detected.chipName;

      // Read the IDF app descriptor before disconnecting — when the
      // chip is running a factory-flashed firmware that sets
      // ``esphome.name`` to a catalog id, ``project_name`` points us
      // straight at the right board. Same flow as
      // ``detectAndOpenWizard`` so both entry points behave alike.
      const manifest = await readDeviceManifest(detected.loader);

      await disconnect(detected.transport);

      if (manifest?.board_id) {
        const knownBoard = await this._api.getBoard(manifest.board_id);
        if (knownBoard) {
          this._onAdd(knownBoard);
          return;
        }
        // ``board_id`` set but the catalog doesn't know it — fall
        // through to chip-family filtering rather than failing.
      }

      // No specific board match — narrow the picker to the detected
      // chip family and let the user pick. The generic-{family}
      // auto-advance used to live here, but landing the user on a
      // filtered picker is the better UX: they can still pick the
      // generic board explicitly, or one of several boards for
      // their chip.
      const label = chipNameToFilterLabel(chipName);
      if (label) {
        this._selectedFilter = label;
        this._filterFromDetection = true;
        this._search = "";
        void this._fetchBoards();
      }
    } catch {
      // User cancelled the port picker or detection failed
    }
  }

  /**
   * Open the server-side port picker, populate the port list via
   * ``config/serial_ports``. The actual detection runs once the
   * user picks a port (in ``_onServerPortSelected``).
   */
  private async _openServerPortPicker() {
    this._view = "select-port";
    this._detectError = "";
    this._serverPorts = [];
    this._loadingServerPorts = true;
    try {
      this._serverPorts = await this._api.getSerialPorts();
    } catch (e) {
      console.error("Failed to load server serial ports:", e);
      this._serverPorts = [];
      this._detectError = this._extractErrorDetail(
        e,
        this._localize("wizard.connect_your_board_detect_failed"),
      );
    } finally {
      this._loadingServerPorts = false;
    }
  }

  private _onServerPortSelected = async (e: CustomEvent<{ port: string }>) => {
    const port = e.detail?.port;
    if (!port) return;
    this._detectingChip = true;
    this._detectError = "";
    try {
      const result = await this._api.detectChip(port);

      if (result.board_id) {
        try {
          const knownBoard = await this._api.getBoard(result.board_id);
          if (knownBoard) {
            this._view = "boards";
            this._onAdd(knownBoard);
            return;
          }
        } catch {
          // Catalog lookup failure shouldn't surface as a detect
          // error — fall through to chip-family filtering instead.
        }
      }

      if (result.chip_family) {
        this._selectedFilter = result.chip_family;
        this._filterFromDetection = true;
        this._search = "";
      }
      this._view = "boards";
      void this._fetchBoards();
    } catch (err) {
      this._detectError = this._extractErrorDetail(
        err,
        this._localize("wizard.connect_your_board_detect_failed"),
      );
    } finally {
      this._detectingChip = false;
    }
  };

  /**
   * Prefer ``APIError.details`` (the human-readable bit) over
   * ``Error.message`` (which carries the ``<code>:`` prefix for an
   * APIError) so the wizard's inline error reads cleanly to a user.
   */
  private _extractErrorDetail(err: unknown, fallback: string): string {
    if (err instanceof APIError) return err.details || fallback;
    if (err instanceof Error) return err.message || fallback;
    return fallback;
  }

  private _onBackFromPortSelect = () => {
    this._view = "boards";
    this._detectError = "";
  };

  private _exitDetectionMode() {
    this._selectedFilter = "";
    this._filterFromDetection = false;
    void this._fetchBoards();
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-wizard-step-board": ESPHomeWizardStepBoard;
  }
}
