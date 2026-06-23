import { consume } from "@lit/context";
import { mdiArrowLeft, mdiClose } from "@mdi/js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { apiErrorDetails } from "../../api/api-error.js";
import type { ESPHomeAPI } from "../../api/index.js";
import type { BoardCatalogEntry } from "../../api/types/boards.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { apiContext, localizeContext } from "../../context/index.js";
import { primaryHeaderDialogStyles } from "../../styles/dialog-chrome.js";
import { fullscreenMobileDialog } from "../../styles/dialog-mobile.js";
import { espHomeStyles } from "../../styles/shared.js";
import { withBase } from "../../util/base-path.js";
import { markJustCreated } from "../../util/just-created.js";
import { markPendingHighlight } from "../../util/pending-highlight.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import {
  ImportFlowController,
  type ImportFlowHost,
  type ImportStep,
} from "./import-flow-controller.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "../base-dialog.js";
import "./wizard-step-board.js";
import "./wizard-step-empty-config.js";
import "./wizard-step-import-partial.js";
import "./wizard-step-method.js";
import "./wizard-step-overwrite-device.js";
import "./wizard-step-resolve-conflicts.js";
import "./wizard-step-setup.js";

registerMdiIcons({ close: mdiClose, "arrow-left": mdiArrowLeft });

type WizardStep =
  | "method"
  | "board"
  | "setup"
  | "empty-config"
  | "resolve-conflicts"
  | "confirm-overwrite"
  | "import-partial";
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
export class ESPHomeCreateConfigDialog extends LitElement implements ImportFlowHost {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: apiContext })
  private _api!: ESPHomeAPI;

  @state()
  private _step: WizardStep = "method";

  // Owned here, not in the method step, so the "Advanced" disclosure stays
  // open when the user navigates into an advanced option (empty-config /
  // import) and back — the step element is unmounted across that transition.
  @state()
  private _advancedOpen = false;

  // Drives the step components' Enter listeners: the steps stay mounted in
  // the wa-dialog while it's merely hidden (light-dismiss / Escape / close),
  // so they must deactivate on hide, not just on unmount.
  @state()
  private _open = false;

  @state()
  private _selectedBoard: BoardCatalogEntry | null = null;

  /** Board id whose full body has already been fetched into `_selectedBoard`,
   *  so re-entering the setup step doesn't refetch (getBoard is uncached). */
  private _upgradedBoardId: string | null = null;

  /** Initial platform-filter label for the board step. Set by
   *  ``openAtBoardStep`` when the caller knows the chip family
   *  (e.g. from serial chip detection) so the picker opens with
   *  the matching chip's filter chip already active. ``null``
   *  means no preset — the picker shows everything. */
  @state()
  private _initialBoardFilter: string | null = null;

  @state()
  private _creationMethod: CreationMethod = "basic";

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

  /** The "Import from file" flow (YAML upload + bundle + overwrite/conflict
   *  round-trips). Kept out of this dialog so it stays a thin step machine. */
  private readonly _import = new ImportFlowController(this);

  static styles = [
    espHomeStyles,
    fullscreenMobileDialog("esphome-base-dialog"),
    // Shared primary header + back button (also used by add-component) —
    // see dialog-chrome.ts.
    primaryHeaderDialogStyles,
    css`
      esphome-base-dialog {
        --width: 520px;
      }

      esphome-base-dialog.wide {
        --width: 750px;
      }

      /* Mobile full-screen comes from fullscreenMobileDialog in the static
         styles so the board picker isn't boxed into a 520px column. #41 */

      esphome-base-dialog::part(body) {
        /* Horizontal gutter drops to a tighter value on the mobile sheet via
           --esphome-dialog-body-gutter (set by fullscreenMobileDialog). */
        padding: var(--wa-space-l) var(--esphome-dialog-body-gutter, var(--wa-space-xl));
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

  /** Open directly at the setup step with a pre-selected **full** board body
   *  (callers resolve it via ``getBoard``), so ``requires_wifi`` is already
   *  known and the Wi-Fi decision is correct on first render. */
  public openWithBoard(board: BoardCatalogEntry) {
    this._step = "setup";
    this._selectedBoard = board;
    this._initialBoardFilter = null;
    this._resetTransientState();
    this._upgradedBoardId = board.id; // already a full body; no upgrade fetch
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

  /** Clear submission / import / error state shared by the two ``open``
   * entry points so a re-open after a prior dismissal doesn't carry stale
   * state across. ``_step`` / ``_selectedBoard`` are intentionally excluded
   * — each entry point sets those to its own starting value before calling
   * here. */
  private _resetTransientState(): void {
    this._creationMethod = "basic";
    this._advancedOpen = false;
    this._import.reset();
    this._submitting = false;
    this._upgradedBoardId = null;
    this._resetCreateErrors();
    this._open = true;
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
    this._open = false;
  }

  // esphome-base-dialog never flips its own open on a user-driven close
  // (Escape / X / outside-click); the host owns _open, else a re-render
  // re-asserts ?open and the dialog can't dismiss.
  private _onRequestClose = () => {
    this._open = false;
  };

  // The step components stay mounted while the dialog is merely hidden, so
  // drop their Enter listeners once it has fully hidden.
  private _onHide = () => {
    this._open = false;
  };

  // ----- ImportFlowHost: the slice the import controller drives -----
  get api(): ESPHomeAPI {
    return this._api;
  }
  get localize(): LocalizeFunc {
    return this._localize;
  }
  get importBusy(): boolean {
    return this._submitting;
  }
  set importBusy(value: boolean) {
    this._submitting = value;
  }
  goToImportStep(step: ImportStep): void {
    this._step = step;
  }
  setImportError(message: string): void {
    this._importError = message;
  }
  resetErrors(): void {
    this._resetCreateErrors();
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
      case "resolve-conflicts":
        return this._localize("wizard.import_bundle_conflicts_title");
      case "confirm-overwrite":
        return this._localize("wizard.overwrite_device_title");
      case "import-partial":
        return this._localize("wizard.import_partial_title");
    }
  }

  protected render() {
    return html`
      <esphome-base-dialog
        class=${this._step === "board" ? "wide" : ""}
        ?open=${this._open}
        ?busy=${this._submitting}
        .label=${this._title}
        @request-close=${this._onRequestClose}
        @after-hide=${this._onHide}
        @next-step=${this._onNextStep}
        @toggle-advanced=${this._onToggleAdvanced}
        @finish-setup=${this._onFinishSetup}
        @create-empty-config=${this._onCreateEmptyConfig}
        @import-file=${this._onImportFile}
        @resolve-conflicts=${this._onResolveConflicts}
        @overwrite-device=${this._onConfirmOverwrite}
        @open-device=${this._onOpenImportedDevice}
      >
        ${this._step !== "method" && this._step !== "import-partial"
          ? html`<button
              slot="header-prefix"
              class="back-button"
              title=${this._localize("layout.back")}
              aria-label=${this._localize("layout.back")}
              @click=${this._onBack}
            >
              <wa-icon library="mdi" name="arrow-left"></wa-icon>
            </button>`
          : nothing}
        ${this._renderStep()}
        ${this._importError ? html`<p class="error">${this._importError}</p>` : nothing}
        ${this._createError ? html`<p class="error">${this._createError}</p>` : nothing}
      </esphome-base-dialog>
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
        return html`<esphome-wizard-step-method
          .advancedOpen=${this._advancedOpen}
        ></esphome-wizard-step-method>`;
      case "board":
        return html`<esphome-wizard-step-board
          .presetFilterLabel=${this._initialBoardFilter}
        ></esphome-wizard-step-board>`;
      case "setup":
        return html`<esphome-wizard-step-setup
          .board=${this._selectedBoard}
          ?active=${this._open}
        ></esphome-wizard-step-setup>`;
      case "empty-config":
        return html`<esphome-wizard-step-empty-config
          ?active=${this._open}
        ></esphome-wizard-step-empty-config>`;
      case "resolve-conflicts":
        return html`<esphome-wizard-step-resolve-conflicts
          .conflicts=${this._import.conflicts}
          .hasSecrets=${this._import.hasSecrets}
          .mainConfig=${this._import.mainConfig}
        ></esphome-wizard-step-resolve-conflicts>`;
      case "confirm-overwrite":
        return html`<esphome-wizard-step-overwrite-device
          .deviceName=${this._import.pendingDeviceName}
        ></esphome-wizard-step-overwrite-device>`;
      case "import-partial":
        return html`<esphome-wizard-step-import-partial
          .kept=${this._import.partial?.kept ?? []}
          ?active=${this._open}
        ></esphome-wizard-step-import-partial>`;
    }
  }

  private _onNextStep(e: CustomEvent<WizardStepDetail>) {
    // A new step starts clean: a failed create's error bar must not follow the
    // user forward (e.g. Back to the board picker, then a different board).
    this._resetCreateErrors();
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

    if (detail.step === "setup" && this._selectedBoard) {
      void this._enterSetupStep(this._selectedBoard);
      return;
    }
    this._step = detail.step;
  }

  /** Upgrade the slim picker entry to the full board body, then show the setup
   *  step — so ``wizard-step-setup`` reads a known ``requires_wifi`` on first
   *  render and can't under-collect Wi-Fi on a Wi-Fi-only board. The picker
   *  stays up during the (uncached) fetch; a cached id skips it. On a failed /
   *  empty fetch we stay on the picker with an error rather than advance on the
   *  slim entry (whose ``requires_wifi`` hydrates to ``false``). */
  private async _enterSetupStep(board: BoardCatalogEntry): Promise<void> {
    if (this._upgradedBoardId !== board.id) {
      let full: BoardCatalogEntry | null = null;
      try {
        full = await this._api.getBoard(board.id);
      } catch (err) {
        console.warn("Failed to load full board body:", err);
      }
      if (this._selectedBoard?.id !== board.id) return; // selection moved on
      if (!full) {
        this._createError = this._localize("wizard.board_load_failed");
        return; // keep the user on the picker to retry
      }
      this._selectedBoard = full;
      this._upgradedBoardId = board.id;
    }
    this._step = "setup";
  }

  private _onToggleAdvanced() {
    this._advancedOpen = !this._advancedOpen;
  }

  private _onImportFile(e: CustomEvent<{ file: File }>) {
    this._creationMethod = "import";
    this._import.start(e.detail.file);
  }

  private _onResolveConflicts(e: CustomEvent<{ overwrite: string[] }>) {
    this._import.resolveConflicts(e.detail.overwrite);
  }

  private _onConfirmOverwrite() {
    this._import.confirmOverwrite();
  }

  private _onOpenImportedDevice() {
    if (this._import.partial) {
      this.navigateToCreated(this._import.partial.configuration);
    }
  }

  private _onBack() {
    this._resetCreateErrors();
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
      case "resolve-conflicts":
        this._step = "method";
        break;
      case "confirm-overwrite":
        this._step = "method";
        break;
    }
  }

  /** Run the post-``createDevice`` UX shared by every wizard path.
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
   * Public so the import controller can reuse it; centralised so the
   * creation paths can't drift on which one-shot signals they arm.
   */
  navigateToCreated(configuration: string): void {
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
        // Send the raw display name: the backend slugifies it for the
        // hostname and keeps the cleaned original as
        // esphome.friendly_name. Slugifying here would strip the
        // friendly name down to the slug (issue #1070).
        name,
        board_id: this._selectedBoard?.id ?? "",
        config_type: "empty",
      },
      { board: this._selectedBoard ?? null }
    );
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
        // Raw display name; backend slugifies for the hostname and
        // preserves the cleaned original as esphome.friendly_name
        // (issue #1070).
        name,
        board_id: board.id,
        config_type: "basic",
        // Typed credentials are persisted to secrets.yaml by the backend and
        // referenced via !secret — never inlined.
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
      // A supplied SSID is persisted to secrets.yaml by the backend; refresh
      // the shared secret-keys cache so the new device's editor doesn't show
      // the just-written `!secret wifi_*` refs as missing until a reload.
      if (args.ssid) window.dispatchEvent(new CustomEvent("secrets-saved"));
      this.navigateToCreated(configuration);
    } catch (err) {
      console.error("Failed to create device:", err);
      this._createError = this._extractCreateErrorMessage(err, options.board ?? null);
    } finally {
      this._submitting = false;
    }
  }

  /** Build a create-flow error message. Falls back to a localised generic
   *  when the error carries no actionable detail (a blank red bar is worse
   *  than 'create failed'). When 'board' is set, the message names the
   *  board the wizard tried to use so a template failure is attributable. */
  private _extractCreateErrorMessage(
    err: unknown,
    board: BoardCatalogEntry | null
  ): string {
    const message = apiErrorDetails(err) || this._localize("wizard.create_general_error");
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
