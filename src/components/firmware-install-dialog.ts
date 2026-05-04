import { consume } from "@lit/context";
import {
  mdiAlertCircle,
  mdiArrowExpand,
  mdiArrowCollapse,
  mdiCheckCircle,
  mdiChevronDown,
  mdiChevronUp,
  mdiClose,
  mdiConsole,
} from "@mdi/js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import type { ESPHomeAPI } from "../api/index.js";
import { JobStatus } from "../api/types.js";
import type { ConfiguredDevice } from "../api/types.js";
import type { LocalizeFunc } from "../common/localize.js";
import { apiContext, darkModeContext, localizeContext } from "../context/index.js";
import { espHomeStyles } from "../styles/shared.js";
import { chipNameToVariant } from "../util/chip-variant.js";
import { dispatchShowLogsAfterInstall } from "../util/post-install-logs.js";
import { registerMdiIcons } from "../util/register-icons.js";
import {
  connectToPort,
  detectChip,
  disconnect,
  flashFirmware,
  resetAndDisconnect,
  type DetectedChip,
} from "../util/web-serial.js";

import "@home-assistant/webawesome/dist/components/dialog/dialog.js";
import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/spinner/spinner.js";
import "./ansi-log.js";

registerMdiIcons({
  "alert-circle": mdiAlertCircle,
  "arrow-expand": mdiArrowExpand,
  "arrow-collapse": mdiArrowCollapse,
  "check-circle": mdiCheckCircle,
  "chevron-down": mdiChevronDown,
  "chevron-up": mdiChevronUp,
  close: mdiClose,
  console: mdiConsole,
});

type InstallStep =
  | "connecting"
  | "queued"
  | "installing"
  | "compiling"
  | "flashing"
  | "done"
  | "download-ready"
  | "error";

@customElement("esphome-firmware-install-dialog")
export class ESPHomeFirmwareInstallDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: darkModeContext, subscribe: true })
  @state()
  private _darkMode = true;

  @consume({ context: apiContext })
  private _api!: ESPHomeAPI;

  @state() private _open = false;
  @state() private _step: InstallStep = "installing";
  @state() private _title = "";
  @state() private _statusMessage = "";
  @state() private _errorMessage = "";
  /** Did this run fail during the server-side compile? Drives the
   *  reset-build-env suggestion strip — only build failures benefit
   *  from clearing the toolchain cache, so we don't dangle the hint
   *  in front of users on chip-mismatch / Web Serial connection
   *  errors where it can't help. */
  @state() private _failedDuringCompile = false;
  @state() private _logLines: string[] = [];
  @state() private _logsExpanded = false;
  @state() private _logsFullHeight = false;
  @state() private _flashPercent = 0;
  @state() private _downloadedFilename = "";
  /** Auto-flip to the logs dialog after a successful Web Serial
   *  install. Default on so users see device output the way
   *  ``esphome run`` does on the CLI; opt out by clicking the
   *  toolbar toggle before the install finishes. Reset to default
   *  per ``_init`` so an opt-out on one run doesn't silently
   *  persist into unrelated future runs. ``installWebDownload``
   *  doesn't connect to a device, so the toggle is install-only. */
  @state() private _showLogsAfterInstall = true;
  /** Which entry point opened the dialog. ``web-serial`` shows the
   *  show-logs-after-install toggle and dispatches the auto-flip on
   *  success; ``web-download`` and ``binary-download`` don't connect
   *  to a device so the toggle is hidden and there's nothing to flip
   *  to. The two download paths share most of the compile + save flow
   *  but differ in the success-screen wording and footer (web-download
   *  routes the user to web.esphome.io; binary-download leaves the
   *  flashing tool to the user). */
  @state() private _installer:
    | "web-serial"
    | "web-download"
    | "binary-download"
    | null = null;

  private _device: ConfiguredDevice | null = null;
  private _jobId = "";
  private _streamId = "";

  /**
   * Reject hook for the in-flight ``_compileAndWait`` promise.
   * ``_compileAndWait`` only settles from the firmwareFollowJob
   * onResult / onError callbacks, but ``_detachStream`` removes the
   * local handler in the API client so those callbacks can never
   * fire after a teardown — without this hook the awaiter
   * (``_startWebSerialInstall``) would hang forever and leak one
   * pending install task per dialog reopen.
   */
  private _compileReject: ((err: Error) => void) | null = null;
  private _detected: DetectedChip | null = null;

  @query("wa-dialog")
  private _dialog!: HTMLElement & { open: boolean };

  // ─── Public API ────────────────────────────────────────

  /**
   * Install firmware via Web Serial. The only install path that lives in this
   * dialog — it needs chip detection + client-side flash progress, which the
   * generic terminal command dialog cannot represent. OTA, server-serial
   * installs, validate, compile, clean all run through `command-dialog.ts`.
   */
  installWebSerial(device: ConfiguredDevice) {
    this._init(device);
    this._installer = "web-serial";
    this._step = "connecting";
    this._statusMessage = this._localize("firmware.status_connecting");
    this._dialog.open = true;
    this._startWebSerialInstall();
  }

  /**
   * Compile the firmware on the server, download the resulting binary
   * to the user's machine, and show instructions to flash it via
   * web.esphome.io. Used as the fallback path when neither OTA nor
   * Web Serial is available (e.g. dashboard served over HTTP and the
   * device is offline / first-flash).
   */
  installWebDownload(device: ConfiguredDevice) {
    this._init(device);
    this._installer = "web-download";
    this._step = "queued";
    this._statusMessage = this._localize("firmware.status_queued");
    this._dialog.open = true;
    this._startDownload();
  }

  /**
   * Compile + download the binary and hand it off to the user without
   * any opinion on how to flash it. Always available from the install
   * picker so users can plug into esptool.py / picotool / a UF2 mass-
   * storage flow without going through the web.esphome.io route.
   */
  installBinaryDownload(device: ConfiguredDevice) {
    this._init(device);
    this._installer = "binary-download";
    this._step = "queued";
    this._statusMessage = this._localize("firmware.status_queued");
    this._dialog.open = true;
    this._startDownload();
  }

  /**
   * Reopen this dialog without clearing the line buffer or status.
   * Used by the logs-dialog's "Back to install" button after the
   * Web Serial post-install hand-off so the user can review the
   * install output. State (status, log lines, success icon) is
   * preserved across the flip.
   */
  public reopen() {
    this._dialog.open = true;
  }

  private _init(device: ConfiguredDevice) {
    // Dispose any stream from a prior session before resetting state.
    // ``_init`` re-runs on every ``installWebSerial`` call, including
    // reopens after the user dismissed the previous run via the
    // ``wa-dialog`` close button / Escape (which routes through
    // ``_onClose`` and only flips ``_open``). Without this teardown a
    // still-attached firmwareFollowJob from the prior compile would
    // keep pushing lines into the new session's ``_logLines``.
    this._detachStream();
    this._device = device;
    this._open = true;
    this._step = "installing";
    this._title = this._localize("firmware.install_title", {
      name: device.friendly_name || device.name,
    });
    this._statusMessage = "";
    this._errorMessage = "";
    this._logLines = [];
    this._logsExpanded = false;
    this._logsFullHeight = false;
    this._flashPercent = 0;
    this._downloadedFilename = "";
    this._showLogsAfterInstall = true;
    this._installer = null;
    this._failedDuringCompile = false;
    // ``_jobId`` is already cleared by ``_detachStream`` above; same
    // for ``_streamId`` and ``_compileReject``.
    this._detected = null;
  }

  /**
   * Tear down any active follow_job subscription, both client-side
   * (drops the local handler so its closure stops appending to
   * ``_logLines``) and backend-side. Settles a pending
   * ``_compileAndWait`` promise so the parent flow doesn't hang
   * waiting for callbacks that can no longer fire, and cancels the
   * underlying firmware job so the backend stops doing work for a
   * dialog the user has dismissed. Safe when no stream is active —
   * every check is null-guarded.
   */
  private _detachStream() {
    if (this._streamId) {
      this._api.stopStream(this._streamId).catch(() => {});
      this._streamId = "";
    }
    if (this._compileReject) {
      const reject = this._compileReject;
      this._compileReject = null;
      reject(new Error("Install dialog dismissed"));
    }
    if (this._jobId) {
      this._api.firmwareCancel(this._jobId).catch(() => {});
      this._jobId = "";
    }
  }

  // ─── Styles ────────────────────────────────────────────

  static styles = [
    espHomeStyles,
    css`
      :host {
        --term-bg: #1e1e1e;
        --term-fg: #d4d4d4;
        --term-border: #333;
        --term-success: #6a9955;
        --term-error: #f44747;
      }
      :host([light]) {
        --term-bg: #f5f5f5;
        --term-fg: #333;
        --term-border: #ddd;
        --term-success: #3d7a28;
        --term-error: #c72e2e;
      }

      wa-dialog {
        --width: 520px;
        transition: width 0.2s;
      }
      :host([expanded]) wa-dialog {
        --width: min(900px, 90vw);
      }

      wa-dialog::part(header) {
        background: var(--esphome-primary);
        padding: 0 var(--wa-space-m);
        height: 40px;
        box-sizing: border-box;
      }
      wa-dialog::part(title) {
        color: var(--esphome-on-primary);
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
      }
      wa-dialog::part(close-button__base) {
        background: transparent;
        border: none;
        box-shadow: none;
        padding: 0;
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

      .status {
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        gap: var(--wa-space-m);
        padding: var(--wa-space-l) 0;
      }

      .status wa-spinner {
        font-size: 36px;
        --indicator-color: var(--esphome-primary);
        --track-color: color-mix(in srgb, var(--esphome-primary), transparent 80%);
      }

      .status-icon {
        font-size: 42px;
      }
      .status-icon--success {
        color: var(--esphome-success);
      }
      .status-icon--error {
        color: var(--esphome-error);
      }

      .status-text {
        font-size: var(--wa-font-size-m);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-normal);
      }

      .status-detail {
        font-size: var(--wa-font-size-xs);
        color: var(--wa-color-text-quiet);
        max-width: 380px;
        line-height: 1.5;
      }

      /* Reset-build-env suggestion — shown only after a compile-step
         failure (see _failedDuringCompile in the host). Sits below
         the error status icon as a calm, secondary hint with the
         action rendered as an inline link inside the sentence so
         the CTA reads as part of the hint, not a second next-step
         button. Visual language deliberately quieter than the red
         error so users read the failure first. */
      .reset-suggestion {
        padding: var(--wa-space-s) var(--wa-space-m);
        margin: var(--wa-space-m) auto 0;
        max-width: 480px;
        border-radius: var(--wa-border-radius-m);
        background: var(--wa-color-surface-lowered);
        font-size: var(--wa-font-size-xs);
        line-height: 1.5;
        color: var(--wa-color-text-normal);
        text-align: center;
      }
      .reset-suggestion-link {
        background: none;
        border: none;
        padding: 0;
        font: inherit;
        color: var(--esphome-primary);
        cursor: pointer;
        text-decoration: underline;
        text-underline-offset: 2px;
      }
      .reset-suggestion-link:hover,
      .reset-suggestion-link:focus-visible {
        text-decoration-thickness: 2px;
        outline: none;
      }

      .instructions {
        margin: var(--wa-space-m) 0 0;
        padding-left: var(--wa-space-l);
        font-size: var(--wa-font-size-xs);
        color: var(--wa-color-text-normal);
        line-height: 1.6;
      }
      .instructions li + li {
        margin-top: var(--wa-space-2xs);
      }

      a.btn {
        text-decoration: none;
      }

      .progress-bar {
        width: 100%;
        height: 6px;
        border-radius: 3px;
        background: var(--wa-color-surface-lowered);
        overflow: hidden;
        margin-top: var(--wa-space-xs);
      }

      .progress-bar-fill {
        height: 100%;
        border-radius: 3px;
        background: var(--esphome-primary);
        transition: width 0.2s;
      }

      .logs-toggle {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 0;
        margin-top: var(--wa-space-m);
        background: none;
        border: none;
        font-family: inherit;
        font-size: var(--wa-font-size-xs);
        color: var(--wa-color-text-quiet);
        cursor: pointer;
      }
      .logs-toggle:hover {
        color: var(--wa-color-text-normal);
      }
      .logs-toggle wa-icon {
        font-size: 16px;
      }

      .logs-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }

      .expand-btn {
        display: inline-flex;
        align-items: center;
        padding: 0;
        background: none;
        border: none;
        font-size: 16px;
        color: var(--wa-color-text-quiet);
        cursor: pointer;
      }
      .expand-btn:hover {
        color: var(--wa-color-text-normal);
      }

      .logs-container {
        margin-top: var(--wa-space-s);
        border: 1px solid var(--term-border);
        border-radius: var(--wa-border-radius-m);
        overflow: hidden;
      }

      esphome-ansi-log {
        --log-height: 200px;
      }

      .logs-container--full esphome-ansi-log {
        --log-height: 50vh;
      }
      esphome-ansi-log::part(container) {
        border-radius: 0;
      }

      .footer {
        display: flex;
        justify-content: flex-end;
        gap: var(--wa-space-s);
        margin-top: var(--wa-space-l);
        padding-top: var(--wa-space-m);
        border-top: var(--wa-border-width-s) solid var(--wa-color-surface-border);
      }

      .btn {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 6px 16px;
        border-radius: var(--wa-border-radius-m);
        font-size: var(--wa-font-size-xs);
        font-weight: var(--wa-font-weight-bold);
        font-family: inherit;
        cursor: pointer;
        border: var(--wa-border-width-s) solid transparent;
      }

      .btn--primary {
        background: var(--esphome-primary);
        color: var(--esphome-on-primary);
      }
      .btn--ghost {
        background: transparent;
        color: var(--wa-color-text-normal);
        border-color: var(--wa-color-surface-border);
      }
      /* Active state for ghost toggle buttons (the show-logs-after
         toggle uses this to read as "currently on"). Mirrors the
         shape used in command-dialog / logs-dialog so the visual
         language is consistent across the install flow. */
      .btn--ghost.is-active {
        background: color-mix(in srgb, var(--esphome-primary), transparent 85%);
        color: var(--esphome-primary);
        border-color: color-mix(in srgb, var(--esphome-primary), transparent 60%);
      }
      .btn--ghost wa-icon {
        font-size: 14px;
      }
    `,
  ];

  protected willUpdate(changedProperties: Map<string, unknown>) {
    if (changedProperties.has("_darkMode")) {
      this.toggleAttribute("light", !this._darkMode);
    }
    if (changedProperties.has("_logsFullHeight")) {
      this.toggleAttribute("expanded", this._logsFullHeight);
    }
  }

  // ─── Render ────────────────────────────────────────────

  protected render() {
    return html`
      <wa-dialog label=${this._title} ?open=${this._open} @wa-after-hide=${this._onClose}>
        ${this._renderStatus()} ${this._renderProgress()} ${this._renderLogs()}
        ${this._renderFooter()}
      </wa-dialog>
    `;
  }

  private _renderStatus() {
    if (this._step === "done") {
      return html`
        <div class="status">
          <wa-icon
            class="status-icon status-icon--success"
            library="mdi"
            name="check-circle"
          ></wa-icon>
          <span class="status-text">${this._statusMessage}</span>
        </div>
      `;
    }
    if (this._step === "download-ready") {
      const filename = this._downloadedFilename;
      // Manual binary download: just acknowledge the file and let the
      // user flash it however they like — no web.esphome.io checklist.
      if (this._installer === "binary-download") {
        return html`
          <div class="status">
            <wa-icon
              class="status-icon status-icon--success"
              library="mdi"
              name="check-circle"
            ></wa-icon>
            <span class="status-text"
              >${this._localize("firmware.binary_download_done_title")}</span
            >
            <span class="status-detail"
              >${this._localize("firmware.binary_download_done_body", { filename })}</span
            >
          </div>
        `;
      }
      return html`
        <div class="status">
          <wa-icon
            class="status-icon status-icon--success"
            library="mdi"
            name="check-circle"
          ></wa-icon>
          <span class="status-text"
            >${this._localize("firmware.web_download_done_title")}</span
          >
          <span class="status-detail"
            >${this._localize("firmware.web_download_done_body", { filename })}</span
          >
        </div>
        <ol class="instructions">
          <li>${this._localize("firmware.web_download_step_open")}</li>
          <li>${this._localize("firmware.web_download_step_connect")}</li>
          <li>${this._localize("firmware.web_download_step_install", { filename })}</li>
        </ol>
      `;
    }
    if (this._step === "error") {
      return html`
        <div class="status">
          <wa-icon
            class="status-icon status-icon--error"
            library="mdi"
            name="alert-circle"
          ></wa-icon>
          <span class="status-text">${this._statusMessage}</span>
          <span class="status-detail">${this._errorMessage}</span>
        </div>
        ${this._renderResetSuggestion()}
      `;
    }
    return html`
      <div class="status">
        <wa-spinner></wa-spinner>
        <span class="status-text">${this._statusMessage}</span>
      </div>
    `;
  }

  /** Hint shown after a compile-step failure pointing the user at
   *  "Reset Build Environment". Only surfaced for failures during
   *  the server-side compile (see ``_failedDuringCompile``) — chip
   *  mismatch / Web Serial connection / flash errors don't benefit
   *  from clearing the toolchain cache.
   *
   *  Inline-link rendering: the action is a clickable link inside
   *  the sentence so the CTA reads as part of the hint. The
   *  translation puts the link text behind a ``{action}`` marker so
   *  other locales can place it wherever reads naturally. */
  private _renderResetSuggestion() {
    if (!this._failedDuringCompile) return nothing;
    const text = this._localize("command.try_reset_suggestion");
    const [before, after = ""] = text.split("{action}");
    return html`
      <div class="reset-suggestion" role="status">
        ${before}<button
          class="reset-suggestion-link"
          @click=${this._tryResetBuildEnv}
        >
          ${this._localize("command.try_reset_button")}</button>${after}
      </div>
    `;
  }

  /** Hand off to the firmware-jobs-dialog's reset flow. Closes the
   *  current install dialog first so the confirm prompt isn't
   *  obscured by an unrelated error surface. */
  private _tryResetBuildEnv = () => {
    this._close();
    this.dispatchEvent(
      new CustomEvent("open-reset-build-env", {
        bubbles: true,
        composed: true,
      })
    );
  };

  private _renderProgress() {
    if (this._step !== "flashing") return nothing;
    return html`
      <div class="progress-bar">
        <div class="progress-bar-fill" style="width:${this._flashPercent}%"></div>
      </div>
    `;
  }

  private _renderLogs() {
    if (this._logLines.length === 0) return nothing;
    return html`
      <div class="logs-header">
        <button
          class="logs-toggle"
          @click=${() => {
            this._logsExpanded = !this._logsExpanded;
          }}
        >
          <wa-icon
            library="mdi"
            name=${this._logsExpanded ? "chevron-up" : "chevron-down"}
          ></wa-icon>
          ${this._logsExpanded
            ? this._localize("firmware.hide_details")
            : this._localize("firmware.show_details")}
        </button>
        ${this._logsExpanded
          ? html`<button
              class="expand-btn"
              @click=${() => {
                this._logsFullHeight = !this._logsFullHeight;
              }}
            >
              <wa-icon
                library="mdi"
                name=${this._logsFullHeight ? "arrow-collapse" : "arrow-expand"}
              ></wa-icon>
            </button>`
          : nothing}
      </div>
      ${this._logsExpanded
        ? html`<div
            class="logs-container ${this._logsFullHeight ? "logs-container--full" : ""}"
          >
            <esphome-ansi-log
              .lines=${this._logLines}
              ?light=${!this._darkMode}
            ></esphome-ansi-log>
          </div>`
        : nothing}
    `;
  }

  private _renderFooter() {
    const isRunning =
      this._step !== "done" && this._step !== "error" && this._step !== "download-ready";
    if (isRunning) {
      /* Surface the show-logs-after-install toggle on Web Serial
         installs so users get the same opt-out point the command
         dialog has. ``installWebDownload`` doesn't connect to a
         device so the toggle is hidden there. */
      const showToggle = this._installer === "web-serial";
      return html`
        <div class="footer">
          ${showToggle
            ? html`<button
                class="btn btn--ghost ${this._showLogsAfterInstall ? "is-active" : ""}"
                @click=${this._toggleShowLogsAfterInstall}
                aria-pressed=${this._showLogsAfterInstall ? "true" : "false"}
                title=${this._localize("command.show_logs_after_install_tooltip")}
              >
                <wa-icon library="mdi" name="console"></wa-icon>
                ${this._localize("command.show_logs_after_install")}
              </button>`
            : nothing}
          <button class="btn btn--ghost" @click=${this._cancel}>
            ${this._localize("command.stop")}
          </button>
        </div>
      `;
    }
    if (this._step === "download-ready") {
      // Manual binary download has no follow-up tool — just close.
      if (this._installer === "binary-download") {
        return html`
          <div class="footer">
            <button class="btn btn--primary" @click=${this._close}>
              ${this._localize("command.close")}
            </button>
          </div>
        `;
      }
      return html`
        <div class="footer">
          <button class="btn btn--ghost" @click=${this._close}>
            ${this._localize("command.close")}
          </button>
          <a
            class="btn btn--primary"
            href="https://web.esphome.io"
            target="_blank"
            rel="noopener noreferrer"
          >
            ${this._localize("firmware.web_download_open_button")}
          </a>
        </div>
      `;
    }
    /* Web Serial install success: surface a "Logs" action so the
       user has a one-click path back to the logs viewer after
       they've clicked its "Back to install" button. Same auto-flip
       handler is reused. ``_detected`` survives the auto-hide path
       (``_onClose`` doesn't clear it) but ``_close`` does, so the
       button only renders while the SerialPort reference is still
       around. */
    const canShowLogs =
      this._installer === "web-serial" &&
      this._step === "done" &&
      this._detected !== null;
    return html`
      <div class="footer">
        ${canShowLogs
          ? html`<button class="btn btn--primary" @click=${this._showLogsAgain}>
                <wa-icon library="mdi" name="console"></wa-icon>
                ${this._localize("command.show_logs")}
              </button>
              <button class="btn btn--ghost" @click=${this._close}>
                ${this._localize("command.close")}
              </button>`
          : html`<button class="btn btn--primary" @click=${this._close}>
              ${this._localize("command.close")}
            </button>`}
      </div>
    `;
  }

  private _showLogsAgain = () => {
    if (this._detected) this._flipToLogs(this._detected.port);
  };

  // ─── Web Serial Install ────────────────────────────────

  private async _startWebSerialInstall() {
    const device = this._device;
    if (!device) return;

    // 1. Connect and detect chip
    let detected: DetectedChip;
    try {
      detected = await detectChip();
    } catch {
      this._close(); // User cancelled port selection
      return;
    }
    this._detected = detected;

    // 2. Verify chip matches device platform
    //
    // `device.target_platform` only carries the YAML's top-level
    // platform key — every ESP32 variant (C3/S2/S3/C6/...) reports as
    // plain "esp32" until the first compile fills in the specifics, so
    // on freshly-created devices the coarse string would falsely
    // reject a perfectly correct chip. Resolve the actual variant via
    // the board catalog (same approach the wizard uses), and only
    // strict-compare when we got authoritative info back.
    this._statusMessage = this._localize("firmware.status_verifying");
    const detectedVariant = chipNameToVariant(detected.chipName);
    let expected = device.target_platform;
    let hasAuthoritativeVariant = false;
    if (device.board_id) {
      try {
        const board = await this._api.getBoard(device.board_id);
        const variant = board?.esphome.variant ?? board?.esphome.platform;
        if (variant) {
          expected = variant;
          hasAuthoritativeVariant = true;
        }
      } catch {
        // Network hiccup — fall back to target_platform below.
      }
    }
    const expectedNorm = expected ? expected.toLowerCase().replace(/-/g, "") : "";
    // Without a resolved variant, "esp32" can stand in for any ESP32
    // family chip — don't reject the install in that case.
    const expectedIsCoarseEsp32 = !hasAuthoritativeVariant && expectedNorm === "esp32";
    console.debug(
      "[Web Serial] Detected chip:",
      detected.chipName,
      "→",
      detectedVariant,
      "| Expected:",
      expected,
      "→",
      expectedNorm,
      "| authoritative:",
      hasAuthoritativeVariant
    );
    if (
      expectedNorm &&
      expectedNorm !== "unknown" &&
      detectedVariant !== expectedNorm &&
      !(expectedIsCoarseEsp32 && detectedVariant.startsWith("esp32"))
    ) {
      try {
        await disconnect(detected.transport);
      } catch {
        /* ignore */
      }
      this._fail(
        this._localize("firmware.chip_mismatch", {
          detected: detected.chipName,
          expected,
        })
      );
      return;
    }

    // Disconnect during compile — we'll reconnect to flash
    try {
      await disconnect(detected.transport);
    } catch {
      /* ignore */
    }

    // 3. Compile
    this._step = "queued";
    this._statusMessage = this._localize("firmware.status_queued");
    try {
      await this._compileAndWait(device.configuration);
    } catch {
      this._failedDuringCompile = true;
      this._fail(this._localize("firmware.compile_failed"));
      return;
    }

    // 4. Download binary
    this._statusMessage = this._localize("firmware.status_downloading");
    let firmwareBytes: Uint8Array;
    let flashAddress = 0x10000;
    try {
      const binaries = await this._api.firmwareGetBinaries(device.configuration);
      // Prefer factory binary (flashes at 0x0, includes bootloader)
      const factory = binaries.find((b) => b.file.includes("factory"));
      const binary = factory || binaries[0];
      if (!binary) {
        this._fail(this._localize("serial.no_firmware"));
        return;
      }
      if (factory) flashAddress = 0x0;
      const result = await this._api.firmwareDownload(device.configuration, binary.file);
      firmwareBytes = Uint8Array.from(atob(result.data), (c) => c.charCodeAt(0));
    } catch {
      this._fail(this._localize("firmware.download_failed"));
      return;
    }

    // 5. Reconnect to the same port (no browser picker) and flash
    this._step = "flashing";
    this._statusMessage = this._localize("firmware.status_flashing");
    this._flashPercent = 0;
    let flashDetected: DetectedChip;
    try {
      flashDetected = await connectToPort(detected.port);
    } catch (err) {
      console.error("[Web Serial] Reconnect failed:", err);
      this._fail(this._localize("firmware.flash_failed"));
      return;
    }

    try {
      await flashFirmware(flashDetected.loader, firmwareBytes, flashAddress, (p) => {
        this._flashPercent = p.percent;
      });
    } catch (err) {
      console.error("[Web Serial] Flash error:", err);
      // If progress reached 100%, treat as success (device may have reset during verification)
      if (this._flashPercent >= 100) {
        console.debug(
          "[Web Serial] Flash reached 100%, treating as success despite error"
        );
      } else {
        try {
          await disconnect(flashDetected.transport);
        } catch {
          /* ignore */
        }
        this._fail(
          err instanceof Error ? err.message : this._localize("firmware.flash_failed")
        );
        return;
      }
    }

    // 6. Reset
    this._statusMessage = this._localize("firmware.status_resetting");
    try {
      await resetAndDisconnect(flashDetected.loader, flashDetected.transport);
    } catch {
      /* ignore reset errors */
    }

    this._statusMessage = this._localize("firmware.status_done");
    this._step = "done";
    /* Only auto-flip if the dialog is still on screen — ``_cancel``
       closes the UI but doesn't actually interrupt the Web Serial
       flash loop, so a dismissed install can still reach this point.
       Without the ``_open`` guard the logs viewer would pop up out
       of nowhere on a user who already walked away. */
    if (this._open && this._showLogsAfterInstall) {
      this._flipToLogs(flashDetected.port);
    }
  }

  /**
   * Successful-Web-Serial-install hand-off: dispatch the same
   * ``request-show-logs-after-install`` event the command-dialog
   * uses, but with the live ``SerialPort`` attached so the host
   * can re-open it at log baud and stream device output without
   * re-prompting the user for port selection. The event is
   * cancelable: only hide this dialog if a host claimed it via
   * ``preventDefault()``. ``reopenInstall`` lets the logs
   * dialog's "Back to install" button bring this dialog back. */
  private _flipToLogs(webSerialPort: SerialPort) {
    const device = this._device;
    if (!device) return;
    const handled = dispatchShowLogsAfterInstall(this, {
      configuration: device.configuration,
      name: device.friendly_name || device.name,
      webSerialPort,
      reopenInstall: () => this.reopen(),
    });
    if (handled) this._dialog.open = false;
  }

  // ─── Download flows (compile + save binary) ────────────────────

  /**
   * Shared compile + save path for both the web.esphome.io route and
   * the manual binary download. Differs only in which binaries are
   * eligible: web.esphome.io needs a self-contained image it can
   * flash at 0x0 (ESP32 ``firmware.factory.bin`` or ESP8266
   * ``firmware.bin``), while the manual route just gives the user
   * whatever artefact the build produced — including .uf2 files for
   * RP2040 / nrf52 / libretiny that the web flasher cannot handle.
   */
  private async _startDownload() {
    const device = this._device;
    if (!device) return;
    const isWebFlasher = this._installer === "web-download";

    try {
      await this._compileAndWait(device.configuration);
    } catch {
      this._failedDuringCompile = true;
      this._fail(this._localize("firmware.compile_failed"));
      return;
    }

    this._statusMessage = this._localize("firmware.status_downloading");
    try {
      const binaries = await this._api.firmwareGetBinaries(device.configuration);
      // Per ESPHome's get_download_types(): ESP32 returns
      // "firmware.factory.bin" (bootloader + partitions + app); ESP8266
      // returns just "firmware.bin" which is itself the full image (no
      // bootloader/partition split on ESP8266). For the web flasher we
      // require one of those — anything else (UF2) is unusable. For the
      // manual route we fall back to the first available binary so
      // non-ESP platforms still get something flashable.
      const flashable =
        binaries.find((b) => b.file === "firmware.factory.bin") ??
        binaries.find((b) => b.file === "firmware.bin") ??
        (isWebFlasher ? undefined : binaries[0]);
      if (!flashable) {
        // The web-flasher path can only handle ESP32 .factory.bin or
        // ESP8266 .bin, so a missing match almost always means a UF2
        // platform — surface that clearly. The manual path falls back
        // to ``binaries[0]`` and only ends up here when nothing was
        // produced at all, so use the more general "no binaries" copy.
        this._fail(
          this._localize(
            isWebFlasher ? "firmware.no_flashable_binary" : "firmware.no_binaries"
          )
        );
        return;
      }
      const result = await this._api.firmwareDownload(
        device.configuration,
        flashable.file
      );
      const bytes = Uint8Array.from(atob(result.data), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.filename;
      a.click();
      URL.revokeObjectURL(url);
      this._downloadedFilename = result.filename;
    } catch {
      this._fail(this._localize("firmware.download_failed"));
      return;
    }

    this._step = "download-ready";
    this._statusMessage = "";
  }

  private _compileAndWait(configuration: string): Promise<void> {
    return new Promise(async (resolve, reject) => {
      // Capture ``reject`` on the dialog so a mid-flight detach
      // (header-X / Escape / reopen) can settle this promise. The
      // followJob callbacks below clear the hook back to ``null``
      // once they fire so a normal completion doesn't double-reject
      // when the next teardown runs.
      this._compileReject = reject;
      try {
        const job = await this._api.firmwareCompile(configuration);
        this._jobId = job.job_id;
        this._streamId = this._api.firmwareFollowJob(job.job_id, {
          onOutput: (line) => {
            if (this._step === "queued") {
              this._step = "compiling";
              this._statusMessage = this._localize("firmware.status_compiling");
            }
            this._logLines = [...this._logLines, line];
          },
          onResult: (data) => {
            this._streamId = "";
            this._jobId = "";
            this._compileReject = null;
            const result = data as unknown as { status: string };
            result.status === JobStatus.COMPLETED
              ? resolve()
              : reject(new Error("Compilation failed"));
          },
          onError: (error) => {
            this._streamId = "";
            this._jobId = "";
            this._compileReject = null;
            reject(new Error(error));
          },
        });
      } catch (err) {
        this._compileReject = null;
        reject(err);
      }
    });
  }

  // ─── Helpers ───────────────────────────────────────────

  private _toggleShowLogsAfterInstall = () => {
    this._showLogsAfterInstall = !this._showLogsAfterInstall;
  };

  private _fail(message: string) {
    this._step = "error";
    this._statusMessage = message;
    this._errorMessage = message;
    this._logsExpanded = true;
  }

  private async _cancel() {
    if (this._jobId) {
      try {
        await this._api.firmwareCancel(this._jobId);
      } catch {
        /* ignore */
      }
    }
    this._close();
  }

  private _close() {
    this._open = false;
    this._device = null;
    // ``_detachStream`` clears ``_jobId`` itself (and cancels the
    // backend job + settles any pending compile promise), so we
    // don't bare-clear it here.
    this._detachStream();
    this.dispatchEvent(new CustomEvent("close", { bubbles: true, composed: true }));
  }

  /**
   * ``wa-dialog``'s close button (header X) and Escape both fire
   * ``wa-after-hide``, which routes here. Has to do the same stream
   * teardown ``_close`` does — otherwise a header-X-then-reopen
   * leaves the prior firmwareFollowJob attached, and lines from that
   * subscription duplicate into the new session's log buffer.
   */
  private _onClose() {
    this._open = false;
    this._detachStream();
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-firmware-install-dialog": ESPHomeFirmwareInstallDialog;
  }
}
