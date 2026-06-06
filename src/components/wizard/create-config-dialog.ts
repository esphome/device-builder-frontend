import { consume } from "@lit/context";
import { mdiArrowLeft, mdiClose } from "@mdi/js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { APIError } from "../../api/api-error.js";
import type { ESPHomeAPI } from "../../api/index.js";
import type { BoardCatalogEntry } from "../../api/types/boards.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { apiContext, localizeContext } from "../../context/index.js";
import { primaryHeaderDialogStyles } from "../../styles/dialog-chrome.js";
import { fullscreenMobileDialog } from "../../styles/dialog-mobile.js";
import { espHomeStyles } from "../../styles/shared.js";
import { withBase } from "../../util/base-path.js";
import { arrayBufferToBase64 } from "../../util/base64.js";
import { markJustCreated } from "../../util/just-created.js";
import { markPendingHighlight } from "../../util/pending-highlight.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { safeUploadFilename } from "../../util/safe-upload-filename.js";
import { isBundleFilename } from "../../util/upload-file-types.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "../base-dialog.js";
import "./wizard-step-board.js";
import "./wizard-step-empty-config.js";
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
export class ESPHomeCreateConfigDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: apiContext })
  private _api!: ESPHomeAPI;

  @state()
  private _step: WizardStep = "method";

  // Drives the step components' Enter listeners: the steps stay mounted in
  // the wa-dialog while it's merely hidden (light-dismiss / Escape / close),
  // so they must deactivate on hide, not just on unmount.
  @state()
  private _open = false;

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

  /** Base64 of the picked bundle, held across the conflict-resolution
   *  round-trip so the user's overwrite choices re-submit the same bytes. */
  private _bundleB64: string | null = null;

  @state()
  private _bundleConflicts: string[] = [];

  @state()
  private _bundleHasSecrets = false;

  /** Main config filename of the bundle, so the resolve step can flag
   *  the row whose overwrite replaces the device (keeping its labels). */
  @state()
  private _bundleMainConfig = "";

  /** Pending YAML upload held while the user confirms overwriting an
   *  existing device. */
  private _pendingUpload: { slug: string; fileContent: string } | null = null;

  /** Set after a bundle import that left some existing files in place, so
   *  the result is shown as a partial import rather than a silent success. */
  @state()
  private _partialImport: { configuration: string; kept: string[] } | null = null;

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
        padding: var(--wa-space-l) var(--wa-space-xl);
      }

      .error {
        color: var(--esphome-error);
        font-size: var(--wa-font-size-s);
        margin-top: var(--wa-space-s);
      }

      .import-partial p {
        margin: 0 0 var(--wa-space-m);
        color: var(--wa-color-text-normal);
        font-size: var(--wa-font-size-s);
      }

      .import-partial ul.kept {
        margin: 0 0 var(--wa-space-l);
        padding-left: var(--wa-space-l);
        max-height: 200px;
        overflow-y: auto;
        font-family: var(--wa-font-family-code, monospace);
        font-size: var(--wa-font-size-s);
        color: var(--wa-color-text-quiet);
        word-break: break-all;
      }

      .partial-actions {
        display: flex;
        justify-content: flex-end;
      }

      .btn-open {
        padding: 8px 18px;
        border-radius: var(--wa-border-radius-m);
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
        font-family: inherit;
        cursor: pointer;
        border: none;
        background: var(--esphome-primary);
        color: var(--esphome-on-primary);
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
    this._bundleB64 = null;
    this._bundleConflicts = [];
    this._bundleHasSecrets = false;
    this._bundleMainConfig = "";
    this._pendingUpload = null;
    this._partialImport = null;
    this._submitting = false;
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
        @finish-setup=${this._onFinishSetup}
        @create-empty-config=${this._onCreateEmptyConfig}
        @import-file=${this._onImportFile}
        @resolve-conflicts=${this._onResolveConflicts}
        @overwrite-device=${this._onConfirmOverwrite}
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
        return html`<esphome-wizard-step-method></esphome-wizard-step-method>`;
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
          .conflicts=${this._bundleConflicts}
          .hasSecrets=${this._bundleHasSecrets}
          .mainConfig=${this._bundleMainConfig}
        ></esphome-wizard-step-resolve-conflicts>`;
      case "confirm-overwrite":
        return html`<esphome-wizard-step-overwrite-device
          .deviceName=${this._pendingUpload?.slug ?? ""}
        ></esphome-wizard-step-overwrite-device>`;
      case "import-partial":
        return this._renderPartialImport();
    }
  }

  private _renderPartialImport() {
    const kept = this._partialImport?.kept ?? [];
    const configuration = this._partialImport?.configuration ?? "";
    return html`
      <div class="import-partial">
        <p>${this._localize("wizard.import_partial_desc", { count: kept.length })}</p>
        <ul class="kept">
          ${kept.map((p) => html`<li>${p}</li>`)}
        </ul>
        <div class="partial-actions">
          <button class="btn-open" @click=${() => this._navigateToCreated(configuration)}>
            ${this._localize("wizard.import_partial_open")}
          </button>
        </div>
      </div>
    `;
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
    // Drop any cached bytes/conflicts from a prior pick so a re-selection
    // can't re-submit the previous file or its stale conflict list.
    this._bundleB64 = null;
    this._bundleConflicts = [];
    this._bundleHasSecrets = false;
    this._bundleMainConfig = "";
    this._pendingUpload = null;
    this._createImportedDevice();
  }

  private _onConfirmOverwrite() {
    if (!this._pendingUpload) return;
    const { slug, fileContent } = this._pendingUpload;
    this._runUpload(slug, fileContent, true);
  }

  private _onResolveConflicts(e: CustomEvent<{ overwrite: string[] }>) {
    this._importBundleFlow(e.detail.overwrite);
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
      case "resolve-conflicts":
        this._step = "method";
        break;
      case "confirm-overwrite":
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

  private async _createImportedDevice() {
    if (this._submitting) return;
    if (!this._importFile) return;

    if (isBundleFilename(this._importFile.name)) {
      await this._importBundleFlow();
      return;
    }

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

    await this._runUpload(slug, fileContent);
  }

  /** Send a YAML upload. A first-time collision (`already_exists`) routes
   *  to the confirm-overwrite step; the user's confirm re-enters here with
   *  `overwrite=true`, which replaces the config and keeps its labels. */
  private async _runUpload(
    slug: string,
    fileContent: string,
    overwrite = false
  ): Promise<void> {
    if (this._submitting) return;
    this._resetCreateErrors();
    this._submitting = true;
    try {
      const { configuration } = await this._api.createDevice({
        name: slug,
        config_type: "upload",
        file_content: fileContent,
        ...(overwrite ? { overwrite: true } : {}),
      });
      this._navigateToCreated(configuration);
    } catch (err) {
      if (!overwrite && err instanceof APIError && err.errorCode === "already_exists") {
        this._pendingUpload = { slug, fileContent };
        this._step = "confirm-overwrite";
        return;
      }
      this._importError =
        this._apiErrorDetails(err) || this._localize("wizard.import_general_error");
    } finally {
      this._submitting = false;
    }
  }

  /** Import an `esphome bundle`. The first call sends the bytes; a
   *  'conflicts' response routes to the resolve-conflicts step, whose
   *  confirm re-enters here with the chosen `overwrite` paths (the cached
   *  base64 is reused so the file isn't re-read). */
  private async _importBundleFlow(overwrite?: string[]): Promise<void> {
    // Flip _submitting synchronously, before the first await (the file
    // read), so a fast double-click can't slip two parallel
    // import_bundle commands through the guard. Both the resolve-step
    // re-entry (which bypasses _createImportedDevice's guard) and the
    // initial import are covered.
    if (this._submitting) return;
    if (!this._importFile) return;
    this._resetCreateErrors();
    this._submitting = true;

    try {
      if (this._bundleB64 === null) {
        try {
          const buffer = await this._importFile.arrayBuffer();
          this._bundleB64 = arrayBufferToBase64(buffer);
        } catch {
          this._importError = this._localize("wizard.import_read_error");
          return;
        }
      }

      const res = await this._api.importBundle({
        file_content_b64: this._bundleB64,
        ...(overwrite !== undefined ? { overwrite } : {}),
      });
      if (res.status === "conflicts") {
        this._bundleConflicts = res.conflicts;
        this._bundleHasSecrets = res.has_secrets;
        this._bundleMainConfig = res.configuration;
        this._step = "resolve-conflicts";
        return;
      }
      // A partial import (some conflicts kept) is shown explicitly so the
      // user knows the device may still run its old config, rather than a
      // silent jump to the editor.
      if (res.kept.length) {
        this._partialImport = { configuration: res.configuration, kept: res.kept };
        this._step = "import-partial";
        return;
      }
      this._navigateToCreated(res.configuration);
    } catch (err) {
      this._importError =
        this._apiErrorDetails(err) || this._localize("wizard.import_general_error");
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
        // Raw display name; backend slugifies for the hostname and
        // preserves the cleaned original as esphome.friendly_name
        // (issue #1070).
        name,
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

  /** The user-facing detail carried by a thrown APIError, or "" if none.
   *  Reads the structured 'details' field directly so callers don't parse
   *  the formatted '<code>: <details>' message string back apart. */
  private _apiErrorDetails(err: unknown): string {
    return err instanceof APIError && err.details.trim() ? err.details.trim() : "";
  }

  /** Build a create-flow error message. Falls back to a localised generic
   *  when the error carries no actionable detail (a blank red bar is worse
   *  than 'create failed'). When 'board' is set, the message names the
   *  board the wizard tried to use so a template failure is attributable. */
  private _extractCreateErrorMessage(
    err: unknown,
    board: BoardCatalogEntry | null
  ): string {
    const message =
      this._apiErrorDetails(err) || this._localize("wizard.create_general_error");
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
