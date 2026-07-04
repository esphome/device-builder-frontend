import { consume } from "@lit/context";
import { mdiUsbPort } from "@mdi/js";
import { LitElement, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { APIError } from "../../api/api-error.js";
import type { ESPHomeAPI } from "../../api/index.js";
import type { SlimBoard } from "../../api/types/boards.js";
import { ESPHOME_DOCS_BASE } from "../../common/docs.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { apiContext, localizeContext } from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import { fetchBoard } from "../../util/board-body-cache.js";
import { debounce } from "../../util/debounce.js";
import { detectEnvironment, type DeploymentEnvironment } from "../../util/environment.js";
import { PagedListController } from "../../util/paged-list-controller.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { SerialPortsPollController } from "../../util/serial-ports-poll-controller.js";
import {
  detectChip,
  disconnect,
  isPortPickerCancel,
  isWebSerialSupported,
  readDeviceManifest,
} from "../../util/web-serial.js";
import {
  WIZARD_BOARD_PLATFORMS,
  chipNameToFilterLabel,
} from "./wizard-step-board-platforms.js";

import { inputStyles } from "../../styles/inputs.js";
import { wizardStepBoardStyles } from "./wizard-step-board.styles.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "./wizard-step-board-list.js";
import "./wizard-step-board-port-select.js";

registerMdiIcons({
  "usb-port": mdiUsbPort,
});

// "I don't know what board I have" guide on the docs site (device-builder-frontend#114).
const UNDERSTANDING_BOARDS_DOCS_URL = `${ESPHOME_DOCS_BASE}/guides/understanding_boards/`;

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

  private _list = new PagedListController<SlimBoard>(this);

  @state()
  private _search = "";

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

  private _portsPoll = new SerialPortsPollController(this, () => this._api);

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
      this._fetchBoards();
    }
    this._portsPoll.set(this._view === "select-port");
  }

  private _fetchBoards() {
    const query = this._search.trim() || undefined;
    const filter = ESPHomeWizardStepBoard.PLATFORMS.find(
      (p) => p.label === this._selectedFilter
    );
    const platform = filter?.platform || undefined;
    const variant = filter?.variant || undefined;
    const mcu = filter?.mcu || undefined;
    this._list.reset((offset, limit) =>
      this._api
        .getBoards({ query, platform, variant, mcu, offset, limit })
        .then((r) => ({ items: r.boards, total: r.total }))
    );
  }

  static styles = [espHomeStyles, inputStyles, wizardStepBoardStyles];

  protected render() {
    if (this._view === "select-port") {
      return html`
        <esphome-wizard-step-board-port-select
          .environment=${this._environment}
          .ports=${this._portsPoll.ports}
          .newPorts=${this._portsPoll.newPorts}
          .loading=${this._portsPoll.loading}
          .detecting=${this._detectingChip}
          .errorMessage=${this._detectError || this._portsError()}
          @select-port=${this._onServerPortSelected}
          @back=${this._onBackFromPortSelect}
        ></esphome-wizard-step-board-port-select>
      `;
    }

    if (this._list.loading && !this._list.hasLoaded) {
      return html`<p class="loading">${this._localize("wizard.loading_boards")}</p>`;
    }

    return html`
      <input
        type="search"
        autocomplete="off"
        .value=${this._search}
        @input=${this._onSearchInput}
        placeholder=${this._localize("wizard.search_boards_placeholder")}
      />

      ${
        this._filterFromDetection
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
                      class="platform-chip ${
                        this._selectedFilter === p.label ? "platform-chip--active" : ""
                      }"
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
                <a
                  class="helper-link"
                  href=${UNDERSTANDING_BOARDS_DOCS_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  ${this._localize("wizard.dont_know_board")}
                </a>
              </div>
              ${
                this._detectError
                  ? html`<div class="detect-error" role="alert">
                      ${this._detectError}
                    </div>`
                  : nothing
              }
            `
      }

      <esphome-wizard-step-board-list
        .boards=${this._list.items}
        .loading=${this._list.loading}
        .loadingMore=${this._list.loadingMore}
        .hasMore=${this._list.hasMore}
        .error=${this._list.hasError}
        .localize=${this._localize}
        @load-more=${this._onLoadMore}
        @add-board=${this._onAddBoard}
      ></esphome-wizard-step-board-list>
    `;
  }

  private _onLoadMore = () => {
    this._list.loadMore();
  };

  private _onAddBoard = (e: CustomEvent<{ board: SlimBoard }>) => {
    this._onAdd(e.detail.board);
  };

  private _onSearchInput(ev: Event) {
    this._search = (ev.target as HTMLInputElement).value;
    this._debouncedSearch();
  }

  private _onPlatformFilter(label: string) {
    this._selectedFilter = this._selectedFilter === label ? "" : label;
    // Manual filter click takes the user out of detection mode —
    // they've decided to browse, possibly narrower or wider than
    // the chip they plugged in.
    this._filterFromDetection = false;
    this._fetchBoards();
  }

  private _onAdd(board: SlimBoard) {
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
    this._openServerPortPicker();
  };

  private async _connectViaWebSerial() {
    this._detectError = "";
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
        const knownBoard = await fetchBoard(this._api, manifest.board_id);
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
      this._applyDetectedFilter(chipNameToFilterLabel(chipName));
      void this._fetchBoards();
    } catch (err) {
      if (isPortPickerCancel(err)) return;
      this._detectError = this._extractErrorDetail(
        err,
        this._localize("wizard.connect_your_board_detect_failed")
      );
    }
  }

  /**
   * Open the server-side port picker. ``_portsPoll`` populates and
   * refreshes the list while the view is showing; the actual
   * detection runs once the user picks a port (in
   * ``_onServerPortSelected``).
   */
  private _openServerPortPicker() {
    this._view = "select-port";
    this._detectError = "";
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
          const knownBoard = await fetchBoard(this._api, result.board_id);
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

      // Resolve to an existing filter chip (same as the WebSerial path);
      // a recognised-but-unfiltered variant (e.g. ESP32-S31) yields null,
      // so the picker is left unfiltered instead of keeping a dead filter.
      this._applyDetectedFilter(
        result.chip_family ? chipNameToFilterLabel(result.chip_family) : null
      );
      this._view = "boards";
      void this._fetchBoards();
    } catch (err) {
      this._detectError = this._extractErrorDetail(
        err,
        this._localize("wizard.connect_your_board_detect_failed")
      );
    } finally {
      this._detectingChip = false;
    }
  };

  /**
   * Port-list fetch failure from the poller. Kept separate from
   * ``_detectError`` (chip-detect failures) so a recovering poll
   * clears only its own error, not a detect error shown mid-list.
   */
  private _portsError(): string {
    return this._portsPoll.error === null
      ? ""
      : this._extractErrorDetail(
          this._portsPoll.error,
          this._localize("wizard.connect_your_board_detect_failed")
        );
  }

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

  // Apply a detected chip's filter, clearing any prior filter when the
  // chip maps to no picker chip (null) so the picker is genuinely
  // unfiltered rather than keeping a stale manual/preset selection.
  private _applyDetectedFilter(label: string | null) {
    this._selectedFilter = label ?? "";
    this._filterFromDetection = label !== null;
    this._search = "";
  }

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
