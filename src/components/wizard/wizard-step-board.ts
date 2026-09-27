import { consume } from "@lit/context";
import { mdiUsbPort } from "@mdi/js";
import { html, LitElement, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { APIError } from "../../api/api-error.js";
import type { ESPHomeAPI } from "../../api/index.js";
import type { SlimBoard } from "../../api/types/boards.js";
import { ESPHOME_DOCS_BASE } from "../../common/docs.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { apiContext, localizeContext } from "../../context/index.js";
import { type BoardDetection, detectBoard } from "../../platforms/detect-board.js";
import { EngineLoadError, preloadEsptool } from "../../platforms/esp/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import { debounce } from "../../util/debounce.js";
import { type DeploymentEnvironment, detectEnvironment } from "../../util/environment.js";
import { fireEvent } from "../../util/fire-event.js";
import { notifyInfo } from "../../util/notify.js";
import { PagedListController } from "../../util/paged-list-controller.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { namedConnectFailure } from "../../util/serial-open-error.js";
import { SerialPortsPollController } from "../../util/serial-ports-poll-controller.js";
import { isWebSerialSupported } from "../../util/web-serial.js";
import {
  resolveDetection,
  WIZARD_BOARD_PLATFORMS,
  type WizardBoardPreset,
} from "./wizard-step-board-platforms.js";

import { inputStyles } from "../../styles/inputs.js";
import { linkButtonStyles } from "../../styles/link-button.js";
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

  /** Filter to apply on first mount: a chip's label (e.g.
   *  ``"ESP32-C6"``) or a whole platform. Set by the parent dialog
   *  when the hardware is known up front — the serial-detect flow
   *  uses this to land the user on a picker already narrowed to it. */
  @property({ attribute: false })
  preset: WizardBoardPreset | null = null;

  private _list = new PagedListController<SlimBoard>(this);

  @state()
  private _search = "";

  @state()
  private _selectedFilter = "";

  /** The detection the active filter came from (preset from the parent,
   *  or the Connect-your-board button after a board was identified), or
   *  null for a manual chip click. In detection mode the picker drops the
   *  filter chips, the Connect-your-board button, and the "don't know"
   *  link: the user has already engaged with detection and just needs to
   *  pick a specific board for what we found. Its ``label`` is the
   *  banner's text; its ``platform``, when set, is the whole-platform
   *  filter. */
  @state()
  private _detection: WizardBoardPreset | null = null;

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
    // Warm the esptool chunk while the user reads the step; a miss only
    // costs the fetch at click time.
    if (isWebSerialSupported()) preloadEsptool();
    // Lit usually sets ``.preset`` before connectedCallback fires
    // (property bindings are applied during element upgrade); ``willUpdate``
    // below covers the dialog re-opening this step while it stays mounted.
    if (this.preset) this._applyDetection(this.preset);
    this._fetchBoards();
  }

  willUpdate(changed: PropertyValues<this>) {
    super.willUpdate(changed);
    // A preset change after mount is the dialog re-opening the step (the
    // next board's detection, or a plain open with none), and it replaces
    // whatever the step showed for the last one. The mount itself is
    // handled above; there the old value is undefined.
    if (changed.has("preset") && changed.get("preset") !== undefined) {
      this._applyDetection(this.preset);
      this._fetchBoards();
    }
    this._portsPoll.set(this._view === "select-port");
  }

  private _fetchBoards() {
    const query = this._search.trim() || undefined;
    const filter = ESPHomeWizardStepBoard.PLATFORMS.find(
      (p) => p.label === this._selectedFilter
    );
    const platform = filter?.platform || this._detection?.platform || undefined;
    const variant = filter?.variant || undefined;
    const mcu = filter?.mcu || undefined;
    this._list.reset((offset, limit) =>
      this._api
        .getBoards({ query, platform, variant, mcu, offset, limit })
        .then((r) => ({ items: r.boards, total: r.total }))
    );
  }

  static styles = [espHomeStyles, inputStyles, linkButtonStyles, wizardStepBoardStyles];

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
        this._detection
          ? html`
              <div class="detection-banner" role="status">
                <span>
                  ${this._localize("wizard.detected_chip_family", {
                    family: this._detection.label,
                  })}
                </span>
                <button
                  class="helper-link link-button"
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
                  class="helper-link link-button"
                  href=${UNDERSTANDING_BOARDS_DOCS_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  ${this._localize("wizard.dont_know_board")}
                </a>
              </div>
            `
      }
      ${
        this._detectError
          ? html`<div class="detect-error" role="alert">${this._detectError}</div>`
          : nothing
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
    this._detection = null;
    this._fetchBoards();
  }

  private _onAdd(board: SlimBoard) {
    fireEvent(this, "next-step", { step: "setup", board });
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
    let detection: BoardDetection | null;
    try {
      detection = await detectBoard(null);
    } catch (err) {
      this._detectError =
        err instanceof EngineLoadError
          ? this._localize("firmware.engine_load_failed")
          : (namedConnectFailure(err, this._localize) ??
            this._extractErrorDetail(
              err,
              this._localize("wizard.connect_your_board_detect_failed")
            ));
      return;
    }
    if (!detection) return; // picker dismissed

    await this._landDetection(detection);
  }

  /**
   * Add the board a detection named; else narrow the picker to what was
   * found and let the user pick (a filtered picker beats auto-advancing to a
   * generic board: they can still pick it explicitly, or one of several
   * boards for their chip), saying so when a named board was not found, and
   * when a device could not be told at all, since the user asked (#1856).
   */
  private async _landDetection(detection: BoardDetection): Promise<void> {
    // The port would not release after the banner read: the board is still
    // named, but it has to be replugged before anything opens the port again.
    if (detection.kind === "named" && detection.portHeld) {
      notifyInfo(this._localize("serial.port_held"));
    }
    const landing = await resolveDetection(this._api, detection);
    if ("board" in landing) {
      this._onAdd(landing.board);
      return;
    }
    this._applyDetection(landing.preset);
    if (landing.missedBoard) {
      this._detectError = this._localize(
        "wizard.connect_your_board_unknown_catalog_board",
        {
          board: landing.missedBoard,
        }
      );
    } else if (detection.kind === "unknown") {
      this._detectError = this._localize("wizard.connect_your_board_unrecognized");
    }
    void this._fetchBoards();
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
      // The backend's esptool answer, landed the same way as the browser's:
      // the named board, else the chip's filter (a recognised but unfiltered
      // variant, e.g. ESP32-S31, leaves the picker open).
      this._view = "boards";
      await this._landDetection({
        kind: "esp",
        board: {
          chipName: result.chip_family ?? "",
          mac: null,
          manifest: result.board_id ? { board_id: result.board_id } : null,
        },
      });
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

  // Apply a detection's filter, clearing any prior filter when it maps to
  // no picker chip (null) so the picker is genuinely unfiltered rather
  // than keeping a stale manual/preset selection.
  private _applyDetection(preset: WizardBoardPreset | null) {
    this._selectedFilter = preset && !preset.platform ? preset.label : "";
    this._detection = preset;
    this._search = "";
  }

  private _exitDetectionMode() {
    this._selectedFilter = "";
    this._detection = null;
    // The detection's own message (a board not found, a device not told)
    // goes with it; the user asked for the full list.
    this._detectError = "";
    void this._fetchBoards();
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-wizard-step-board": ESPHomeWizardStepBoard;
  }
}
