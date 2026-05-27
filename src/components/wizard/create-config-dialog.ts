import { consume } from "@lit/context";
import { mdiArrowLeft, mdiClose } from "@mdi/js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { APIError } from "../../api/api-error.js";
import type { BoardCatalogEntry } from "../../api/types.js";
import type { ESPHomeAPI } from "../../api/index.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { localizeContext, apiContext } from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import { withBase } from "../../util/base-path.js";
import { friendlyNameSlugify } from "../../util/friendly-name-slugify.js";
import { markJustCreated } from "../../util/just-created.js";
import { markPendingHighlight } from "../../util/pending-highlight.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { safeUploadFilename } from "../../util/safe-upload-filename.js";

import "@home-assistant/webawesome/dist/components/dialog/dialog.js";
import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "./wizard-step-board.js";
import "./wizard-step-empty-config.js";
import "./wizard-step-method.js";
import "./wizard-step-setup.js";

registerMdiIcons({ close: mdiClose, "arrow-left": mdiArrowLeft });

type WizardStep = "method" | "board" | "setup" | "empty-config";
type CreationMethod = "basic" | "empty" | "import";
type WizardStepDetail =
  | WizardStep
  | {
      step: WizardStep;
      board?: BoardCatalogEntry | null;
      method?: CreationMethod;
      file?: File;
    };

@customElement("esphome-create-config-dialog")
export class ESPHomeCreateConfigDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: apiContext })
  private _api!: ESPHomeAPI;

  @state()
  private _step: WizardStep = "method";

  @state()
  private _selectedBoard: BoardCatalogEntry | null = null;

  /** Initial platform-filter label for the board step. Set by
   *  ``openAtBoardStep`` when the caller knows the chip family
   *  (e.g. from serial chip detection) so the picker opens with
   *  the matching chip's filter chip already active. ``null``
   *  means no preset — the picker shows everything. */
  @state()
  private _initialBoardFilter: string | null = null;

  @state()
  private _creationMethod: CreationMethod = "basic";

  /** Stored file for import flow (selected before board step). */
  private _importFile: File | null = null;

  @state()
  private _submitting = false;

  @state()
  private _importError = "";

  /** Catch-all error for the empty / basic create flows.
   *
   * Mirrors ``_importError`` but for the two paths that don't have
   * their own bespoke "duplicate"/"invalid filename" messages. A
   * backend ``CommandError`` (validation reject, name collision,
   * unknown board, ...) lands here so the user sees something
   * actionable on the dialog instead of the failure dropping
   * silently to the browser console.
   */
  @state()
  private _createError = "";

  @query("wa-dialog")
  private _dialog!: HTMLElement & { open: boolean };

  static styles = [
    espHomeStyles,
    css`
      wa-dialog {
        --width: 520px;
      }

      wa-dialog.wide {
        --width: 750px;
      }

      wa-dialog::part(header) {
        background: var(--esphome-primary);
        /* Right padding is 0 so the close button sits flush with the
           dialog's corner — the button is explicitly sized to a 40x40
           square below to give the X a comfortable hit target right
           where the user reaches for it. */
        padding: 0 0 0 var(--wa-space-m);
        height: 40px;
        box-sizing: border-box;
      }

      wa-dialog::part(title) {
        color: var(--esphome-on-primary);
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
      }

      .dialog-label {
        display: flex;
        align-items: center;
        gap: var(--wa-space-xs);
        color: var(--esphome-on-primary);
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
      }

      .back-button {
        display: inline-flex;
        align-items: center;
        border: none;
        background: none;
        padding: 2px;
        margin-right: var(--wa-space-2xs);
        color: var(--esphome-on-primary);
        cursor: pointer;
        border-radius: 4px;
        opacity: 0.85;
      }

      .back-button:hover {
        opacity: 1;
      }

      wa-dialog::part(close-button__base) {
        background: transparent;
        border: none;
        box-shadow: none;
        /* Square 40x40 button matching the header height so the X has a
           comfortable click/tap target instead of just the icon's
           ~14px footprint. */
        padding: 0;
        width: 40px;
        height: 40px;
        min-width: unset;
        min-height: unset;
        color: var(--esphome-on-primary);
        cursor: pointer;
      }

      wa-dialog::part(body) {
        padding: var(--wa-space-l) var(--wa-space-xl);
      }

      wa-dialog::part(footer) {
        display: none;
      }

      .error {
        color: var(--esphome-error);
        font-size: var(--wa-font-size-s);
        margin-top: var(--wa-space-s);
      }
    `,
  ];

  public open(startStep?: WizardStep) {
    this._step = startStep ?? "method";
    this._selectedBoard = null;
    this._initialBoardFilter = null;
    this._resetTransientState();
  }

  /** Open directly at the setup step with a pre-selected board. */
  public openWithBoard(board: BoardCatalogEntry) {
    this._step = "setup";
    this._selectedBoard = board;
    this._initialBoardFilter = null;
    this._resetTransientState();
  }

  /** Open directly at the board-picker step with an optional
   *  platform filter pre-applied. Used by the serial-detect flow
   *  when the chip family is known but no specific board is
   *  recognised — the user lands on a picker already narrowed to
   *  their chip instead of the full catalog. */
  public openAtBoardStep(filterLabel?: string) {
    this._step = "board";
    this._selectedBoard = null;
    this._initialBoardFilter = filterLabel ?? null;
    this._resetTransientState();
  }

  /** Clear submission / file / error state shared by the two
   * ``open`` entry points so a re-open after a prior dismissal
   * doesn't carry stale state across. ``_step`` /
   * ``_selectedBoard`` are intentionally excluded — each entry
   * point sets those to its own starting value before calling
   * here. */
  private _resetTransientState(): void {
    this._creationMethod = "basic";
    this._importFile = null;
    this._submitting = false;
    this._resetCreateErrors();
    this._dialog.open = true;
  }

  /** Clear both error slots so a stale message from a prior
   * attempt (e.g. a failed import the user backed out of)
   * doesn't sit alongside whatever this attempt produces. Both
   * slots clear together because the two flows share the same
   * dialog body — leaving ``_importError`` set while showing
   * ``_createError`` would render two red bars stacked. */
  private _resetCreateErrors(): void {
    this._importError = "";
    this._createError = "";
  }

  public close() {
    this._dialog.open = false;
  }

  private get _title(): string {
    switch (this._step) {
      case "method":
        return this._localize("wizard.title_create");
      case "board":
        return this._localize("wizard.title_board");
      case "setup":
        return this._localize("wizard.title_setup");
      case "empty-config":
        return this._localize("wizard.title_empty_config");
    }
  }

  protected render() {
    return html`
      <wa-dialog
        class=${this._step === "board" ? "wide" : ""}
        light-dismiss
        @next-step=${this._onNextStep}
        @finish-setup=${this._onFinishSetup}
        @create-empty-config=${this._onCreateEmptyConfig}
        @import-file=${this._onImportFile}
      >
        <span slot="label" class="dialog-label">
          ${this._step !== "method"
            ? html`<button class="back-button" @click=${this._onBack}>
                <wa-icon library="mdi" name="arrow-left"></wa-icon>
              </button>`
            : nothing}
          ${this._title}
        </span>
        ${this._renderStep()}
        ${this._importError ? html`<p class="error">${this._importError}</p>` : nothing}
        ${this._createError ? html`<p class="error">${this._createError}</p>` : nothing}
      </wa-dialog>
    `;
  }

  private _renderStep() {
    // Show loading message while import creation is in progress
    if (this._submitting && this._creationMethod === "import") {
      return html`<p
        style="text-align:center;color:var(--wa-color-text-quiet);padding:var(--wa-space-xl) 0"
      >
        ${this._localize("wizard.importing_device")}
      </p>`;
    }

    switch (this._step) {
      case "method":
        return html`<esphome-wizard-step-method></esphome-wizard-step-method>`;
      case "board":
        return html`<esphome-wizard-step-board
          .presetFilterLabel=${this._initialBoardFilter}
        ></esphome-wizard-step-board>`;
      case "setup":
        return html`<esphome-wizard-step-setup
          .board=${this._selectedBoard}
        ></esphome-wizard-step-setup>`;
      case "empty-config":
        return html`<esphome-wizard-step-empty-config></esphome-wizard-step-empty-config>`;
    }
  }

  private _onNextStep(e: CustomEvent<WizardStepDetail>) {
    const detail = e.detail;
    if (typeof detail === "string") {
      this._step = detail;
      return;
    }

    // Track creation method when coming from method step.
    if (detail.method) {
      this._creationMethod = detail.method;
    }

    if (detail.board !== undefined) {
      this._selectedBoard = detail.board;
    }

    this._step = detail.step;
  }

  private _onImportFile(e: CustomEvent<{ file: File }>) {
    this._creationMethod = "import";
    this._importFile = e.detail.file;
    this._createImportedDevice();
  }

  private _onBack() {
    switch (this._step) {
      case "board":
        this._step = "method";
        break;
      case "setup":
        this._step = "board";
        break;
      case "empty-config":
        this._step = "method";
        break;
    }
  }

  /** Run the post-``createDevice`` UX shared by all three wizard paths.
   *
   * - ``markJustCreated`` arms the device editor's one-shot welcome
   *   banner (consumed on first mount).
   * - ``markPendingHighlight`` arms the dashboard's one-shot
   *   highlight + scroll for the next time the user lands back on
   *   ``/`` (e.g. after closing the editor with the back button).
   * - Then close the dialog and navigate to the device editor.
   *   ``encodeURIComponent`` keeps spaces / Unicode safe in the URL
   *   — ``app-shell``'s router render decodes the param on the
   *   receiving side so ``this.id`` stays the raw filename for
   *   ``configuration`` comparison.
   *
   * Centralised so the three creation paths can't drift on which
   * one-shot signals they arm — every path opens the editor and
   * arms both flags.
   */
  private _navigateToCreated(configuration: string): void {
    markJustCreated(configuration);
    markPendingHighlight(configuration);
    this.close();
    window.history.pushState(
      {},
      "",
      withBase(`/device/${encodeURIComponent(configuration)}`)
    );
    window.dispatchEvent(new PopStateEvent("popstate"));
  }

  private async _onCreateEmptyConfig(e: CustomEvent<{ name: string }>) {
    const { name } = e.detail;
    await this._runCreate(
      {
        name: friendlyNameSlugify(name),
        board_id: this._selectedBoard?.id ?? "",
        config_type: "empty",
      },
      { board: this._selectedBoard ?? null }
    );
  }

  private async _createImportedDevice() {
    if (this._submitting) return;
    if (!this._importFile) return;

    this._resetCreateErrors();

    let fileContent: string;
    try {
      fileContent = await this._importFile.text();
    } catch {
      this._importError = this._localize("wizard.import_read_error");
      return;
    }

    // Preserve the user's original filename character-for-character —
    // they're importing a working config, not typing a new device
    // name. ``safeUploadFilename`` only strips characters that would
    // actually break a filesystem write (NUL, path separators,
    // Windows-illegal punctuation) so underscores, accented letters,
    // and non-Latin scripts all round-trip.
    const name = this._importFile.name.replace(/\.(yaml|yml)$/i, "");
    const slug = safeUploadFilename(name);

    // ``safeUploadFilename`` returns ``""`` when the input was made
    // entirely of stripped chars (``"..."``, ``"///"``, ``"\x00"``).
    // Surface a specific error before the network call instead of
    // letting the backend's generic ``INVALID_ARGS`` bubble up as
    // ``import_general_error`` — the user can rename the file and
    // try again, which they can't do if we hide the actual cause.
    if (!slug) {
      this._importError = this._localize("wizard.import_invalid_filename", {
        name,
      });
      return;
    }

    this._submitting = true;
    try {
      const { configuration } = await this._api.createDevice({
        name: slug,
        config_type: "upload",
        file_content: fileContent,
      });
      this._navigateToCreated(configuration);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this._importError = msg.includes("409")
        ? this._localize("wizard.import_duplicate_error", { name: slug })
        : this._localize("wizard.import_general_error");
    } finally {
      this._submitting = false;
    }
  }

  private async _onFinishSetup(
    e: CustomEvent<{
      board: BoardCatalogEntry | null;
      name: string;
      wifiSsid: string;
      wifiPassword: string;
    }>
  ) {
    const { board, name, wifiSsid, wifiPassword } = e.detail;
    if (!board) return;
    await this._runCreate(
      {
        name: friendlyNameSlugify(name),
        board_id: board.id,
        config_type: "basic",
        ssid: wifiSsid,
        psk: wifiPassword,
      },
      { board }
    );
  }

  /** Run a ``createDevice`` call with shared error-handling glue.
   *
   * Centralises the submitting flag, the dual error reset, the
   * success navigation, and the catch-side error extraction so
   * the empty- and basic-setup flows can't drift on which
   * failure modes get surfaced to the user. The ``board``
   * option, when provided, is woven into the error message so a
   * template-generation failure tells the user *which* board
   * they were on (the bug behind the "AquaPing for d1_mini"
   * report — once the backend rejects a bad template, the
   * dashboard should at least name the board the wizard tried
   * to use).
   */
  private async _runCreate(
    args: {
      name: string;
      board_id?: string;
      config_type?: string;
      ssid?: string;
      psk?: string;
      file_content?: string;
    },
    options: { board?: BoardCatalogEntry | null } = {}
  ): Promise<void> {
    if (this._submitting) return;
    this._resetCreateErrors();
    this._submitting = true;
    try {
      const { configuration } = await this._api.createDevice(args);
      this._navigateToCreated(configuration);
    } catch (err) {
      console.error("Failed to create device:", err);
      this._createError = this._extractCreateErrorMessage(err, options.board ?? null);
    } finally {
      this._submitting = false;
    }
  }

  /** Pull the user-facing message out of an APIError-shaped failure.
   *
   * Reads the structured ``details`` field directly when the WS
   * client throws an :class:`APIError`, so we don't have to parse
   * the formatted ``"<code>: <details>"`` message string back
   * apart. Falls back to a localised generic for any non-APIError
   * shape (transport failures, unexpected non-Error throws) and
   * for the case where ``details`` is empty (e.g. ``invalid_args:``
   * with no body — empty after trimming would otherwise render as
   * a blank red bar on the dialog, which is worse than a generic
   * "create failed").
   *
   * When ``board`` is provided, the result is wrapped with
   * ``wizard.create_with_board_error`` so the displayed message
   * names the board the wizard was trying to use. The basic-setup
   * flow always passes a board; the empty-config flow only does
   * when the user picked one (it's optional there).
   */
  private _extractCreateErrorMessage(
    err: unknown,
    board: BoardCatalogEntry | null
  ): string {
    let message: string;
    if (err instanceof APIError && err.details.trim()) {
      message = err.details.trim();
    } else {
      message = this._localize("wizard.create_general_error");
    }
    if (board) {
      return this._localize("wizard.create_with_board_error", {
        board: board.name,
        message,
      });
    }
    return message;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-create-config-dialog": ESPHomeCreateConfigDialog;
  }
}
