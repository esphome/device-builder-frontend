import { consume } from "@lit/context";
import {
  mdiAlertCircle,
  mdiArrowCollapse,
  mdiArrowExpand,
  mdiArrowLeft,
  mdiClose,
  mdiDeleteSweep,
  mdiDownload,
  mdiPlay,
  mdiPulse,
  mdiRestart,
  mdiStop,
} from "@mdi/js";
import { LitElement, html } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { ESPHomeAPI } from "../api/index.js";
import type { LocalizeFunc } from "../common/localize.js";
import { apiContext, darkModeContext, localizeContext } from "../context/index.js";
import { primaryDialogHeaderStyles } from "../styles/dialog-header.js";
import { fullscreenMobileDialog } from "../styles/dialog-mobile.js";
import { espHomeStyles } from "../styles/shared.js";
import { textStyles } from "../styles/text.js";
import { type CrashKind, classifyLine } from "../util/crash-detector.js";
import { normalizeLogLine } from "../util/log-line.js";
import { initialDarkMode } from "../util/dark-mode.js";
import { configurationStem, downloadAnsiText } from "../util/download-text.js";
import { LogBuffer } from "../util/log-buffer.js";
import { notifyError } from "../util/notify.js";
import { registerMdiIcons } from "../util/register-icons.js";
import { CrashDecodeController } from "./crash-decode-controller.js";
import {
  abortSerialReconnect,
  onStart,
  onStop,
  openOta,
  openPassive,
  setSerialOpenFailed,
  setSerialStream,
  teardownSession,
  toggleShowStates,
} from "./logs-dialog/session.js";
import type { ESPHomeCrashReportDialog } from "./crash-report-dialog.js";
import { logsDialogStyles } from "./logs-dialog.styles.js";
import {
  type LogsSession,
  OTA_PORT,
  hasSerialPort,
  isOtaNetwork,
  isPassive,
  isStreaming,
} from "./logs-session.js";
import type { ESPHomeProcessTerminal } from "./process-terminal/process-terminal.js";
import {
  fillTerminalOnMobile,
  termButtonStyles,
  termTokens,
} from "./process-terminal/process-terminal.styles.js";
import { renderTermButton, renderTermToggle } from "./process-terminal/toolbar-button.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "./base-dialog.js";
import "./crash-report-dialog.js";
import "./process-terminal/process-terminal.js";

registerMdiIcons({
  "alert-circle": mdiAlertCircle,
  "arrow-collapse": mdiArrowCollapse,
  "arrow-expand": mdiArrowExpand,
  "arrow-left": mdiArrowLeft,
  close: mdiClose,
  download: mdiDownload,
  play: mdiPlay,
  stop: mdiStop,
  "delete-sweep": mdiDeleteSweep,
  pulse: mdiPulse,
  restart: mdiRestart,
});

// Hard cap on retained log lines. A verbose (or garbage-flooding) device can
// emit faster than the view renders; without a bound the line array and its
// DOM grow until the tab locks up. Trimmed to the newest on every flush.
const MAX_LOG_LINES = 5000;

@customElement("esphome-logs-dialog")
export class ESPHomeLogsDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  _localize: LocalizeFunc = (key) => key;

  @consume({ context: darkModeContext, subscribe: true })
  @state()
  private _darkMode = initialDarkMode();

  @consume({ context: apiContext })
  _api!: ESPHomeAPI;

  @property()
  configuration = "";

  @property()
  name = "";

  // The active log source + its lifecycle. Single source of truth; the toolbar
  // (streaming dot, Stop/Start, Reset enablement, source chip) all derive from
  // it. See logs-session.ts for the states and why they're a union.
  @state() _session: LogsSession = { kind: "idle" };

  @state()
  _expanded = false;

  @state()
  _showStates = true;

  /**
   * Set when this session was launched as the post-install logs
   * hand-off. Surfaces a "Back to install" button in the toolbar;
   * clicking it stops the stream, closes the dialog, and invokes
   * the supplied callback so the source install dialog (could be
   * either the command-dialog or the firmware-install-dialog) can
   * re-show itself with its preserved state. Reset on every fresh
   * ``open`` / ``openPassive`` so the affordance only appears for
   * the run that asked for it.
   */
  @state()
  _backToInstall = false;
  _backToInstallHandler: (() => void) | null = null;

  // Reconnect hook for a Web Serial session whose reader is gone (a reopen
  // failed -> `dead`); the "click Start to reconnect" recovery (#636).
  _reconnect: (() => Promise<void>) | null = null;

  // The visible log, its cap, and the stream-position map inline decoding
  // needs. Owns every line the dialog shows; the dialog holds no counters.
  _log = new LogBuffer(this, {
    maxLines: MAX_LOG_LINES,
    onAppend: (lines, start) => this._onLinesAppended(lines, start),
  });

  // Latched once a crash marker flows through _onLinesAppended; drives the
  // "Report this crash" callout for the rest of the session. A live panic
  // upgrades a previous-boot report; nothing downgrades it.
  @state()
  private _crashKind: CrashKind | null = null;

  // Read lazily so field-initialisation order doesn't matter.
  private _crashDecode = new CrashDecodeController({
    api: () => this._api,
    configuration: () => this.configuration,
    buffer: () => this._log,
  });

  // Rendered unconditionally in this dialog's template, so the query is
  // always resolved by the time the callout button can be clicked.
  @query("esphome-crash-report-dialog")
  private _crashReportDialog!: ESPHomeCrashReportDialog;

  @state()
  _open = false;

  @query("esphome-process-terminal")
  private _terminal?: ESPHomeProcessTerminal;

  // Read by `streamSerialToDialog` to gate appends while the log is paused (the
  // reader keeps draining the open port; we just stop displaying).
  get _serialPaused(): boolean {
    const s = this._session;
    return (s.kind === "serial" || s.kind === "reconnecting") && s.paused;
  }

  static styles = [
    espHomeStyles,
    primaryDialogHeaderStyles,
    termTokens,
    termButtonStyles,
    textStyles,
    logsDialogStyles,
    // Full-screen on mobile, terminal fills it.
    fullscreenMobileDialog("esphome-base-dialog"),
    fillTerminalOnMobile,
  ];

  protected willUpdate(changedProperties: Map<string, unknown>) {
    if (changedProperties.has("_darkMode")) {
      this.toggleAttribute("light", !this._darkMode);
    }
    if (changedProperties.has("_expanded")) {
      this.toggleAttribute("expanded", this._expanded);
    }
  }

  public open(port = OTA_PORT, options: { onBackToInstall?: () => void } = {}) {
    openOta(this, port, options);
  }

  public openPassive(options: {
    onReconnect: () => Promise<void>;
    onBackToInstall?: () => void;
  }) {
    openPassive(this, options);
  }

  /** Register the Web Serial reader (its loop-cancel) + port. Called by
   *  `attachSerialLogStream` once a port is open and streaming. */
  public setSerialStream(port: SerialPort, cancel: () => void) {
    setSerialStream(this, port, cancel);
  }

  /** Surface a failure to reopen the Web Serial port for post-install logs.
   *  The caller pairs this with a ``toast.error``. */
  public setSerialOpenFailed(message: string) {
    setSerialOpenFailed(this, message);
  }

  /** Return an in-flight reconnect to ``dead`` without surfacing an error. */
  public abortSerialReconnect() {
    abortSerialReconnect(this);
  }

  public close() {
    void teardownSession(this);
    this._open = false;
  }

  _resetAnsiLogScroll() {
    /* The ansi-log instance is reused across opens. If the user
       scrolled up in a previous session its ``_isUserScrolled`` flag
       is still true, which suppresses auto-scroll for the new
       session — incoming lines pile up unseen until the user scrolls
       back to the bottom themselves. ``scrollToBottom()`` clears the
       flag and forces a scroll. updateComplete makes sure the @query
       has resolved on first open. */
    this.updateComplete.then(() => this._terminal?.scrollToBottom());
  }

  protected render() {
    const s = this._session;
    const streaming = isStreaming(s);
    const passive = isPassive(s);
    const title = this._localize("dashboard.logs_title", { name: this.name });
    // Web Serial's source label keys off the passive states; OTA / server-serial
    // show the target port.
    const source = passive
      ? this._localize("dashboard.logs_source_web_serial")
      : s.kind === "ota"
        ? s.port
        : "";
    const toggleLabel = this._localize(
      this._showStates ? "dashboard.logs_hide_states" : "dashboard.logs_show_states"
    );
    const expandLabel = this._localize(
      this._expanded ? "dashboard.logs_collapse" : "dashboard.logs_expand"
    );

    return html`
      <esphome-base-dialog
        ?open=${this._open}
        .label=${title}
        @request-close=${this._onDialogRequestClose}
        @after-hide=${this._onDialogHide}
      >
        <span slot="header-suffix" class="source-chip truncate" title=${source}
          >${source}</span
        >
        <esphome-process-terminal
          .lines=${this._log.lines}
          placeholder=${this._localize("dashboard.logs_placeholder")}
          ?light=${!this._darkMode}
          ?streaming=${streaming}
        >
          ${
            this._backToInstall
              ? html`<div class="toolbar-slot" slot="toolbar-left">
                  ${renderTermButton({
                    icon: "arrow-left",
                    label: this._localize("dashboard.logs_back_to_install"),
                    title: this._localize("dashboard.logs_back_to_install_tooltip"),
                    onClick: this._onBackToInstall,
                  })}
                </div>`
              : ""
          }
          ${
            this._crashKind !== null
              ? html`<div class="crash-callout" slot="suggestion">
                  <wa-icon library="mdi" name="alert-circle"></wa-icon>
                  <!-- Live region on the text only: announcing the whole row
                       would read the button as part of a status message. -->
                  <span class="crash-callout-text" role="status"
                    >${this._localize(
                      this._crashKind === "previous-boot"
                        ? "crash_report.banner_previous_boot"
                        : "crash_report.banner"
                    )}</span
                  >
                  <button
                    type="button"
                    class="term-btn crash-callout-button"
                    @click=${this._openCrashReport}
                  >
                    ${this._localize("crash_report.report_button")}
                  </button>
                </div>`
              : ""
          }
          <div class="toolbar-slot" slot="toolbar-right">
            ${
              passive
                ? // Web Serial only; disabled until a port is attached.
                  renderTermButton({
                    icon: "restart",
                    label: this._localize("dashboard.logs_reset_device"),
                    disabled: !hasSerialPort(s),
                    onClick: this._onResetDevice,
                  })
                : isOtaNetwork(s)
                  ? // States arrive only over the network/API connection, so the
                    // toggle is hidden for a server serial source (#539).
                    renderTermToggle({
                      active: this._showStates,
                      onClick: this._toggleShowStates,
                      icon: "pulse",
                      label: this._localize("dashboard.logs_states"),
                      title: toggleLabel,
                    })
                  : ""
            }
            <!-- Kept inline: the expand-btn class drives the mobile hide rule. -->
            <button
              type="button"
              class="term-btn term-btn--ghost expand-btn"
              @click=${this._toggleExpanded}
              title=${expandLabel}
              aria-label=${expandLabel}
            >
              <wa-icon
                library="mdi"
                name=${this._expanded ? "arrow-collapse" : "arrow-expand"}
              ></wa-icon>
            </button>
            ${renderTermButton({
              icon: "download",
              title: this._localize("dashboard.logs_download"),
              onClick: this._downloadLogs,
            })}
            ${renderTermButton({
              icon: "delete-sweep",
              label: this._localize("dashboard.logs_clear"),
              onClick: this._clearLogs,
            })}
            ${
              streaming
                ? renderTermButton({
                    icon: "stop",
                    label: this._localize("dashboard.logs_stop"),
                    variant: "stop",
                    onClick: this._onStop,
                  })
                : renderTermButton({
                    icon: "play",
                    label: this._localize("dashboard.logs_start"),
                    variant: "start",
                    onClick: this._onStart,
                  })
            }
          </div>
        </esphome-process-terminal>
      </esphome-base-dialog>
      <esphome-crash-report-dialog></esphome-crash-report-dialog>
    `;
  }

  // Snapshot the buffer (post-flush, so nothing batched for the next frame
  // is missed) and hand it to the report dialog. The logs dialog stays open
  // underneath; the stream keeps running.
  private _openCrashReport = () => {
    this._log.flush();
    this._crashReportDialog.open(
      this.configuration,
      this.name,
      [...this._log.lines],
      this._crashDecode.staleBuild
    );
  };

  private _onStart() {
    onStart(this);
  }

  private _onStop() {
    onStop(this);
  }

  private _downloadLogs() {
    this._log.flush();
    const stem = configurationStem(this.configuration, "logs");
    downloadAnsiText(this._log.lines, `${stem}-logs.txt`);
  }

  private _toggleExpanded() {
    this._expanded = !this._expanded;
  }

  // Returns the restart so a caller can await the respawn landing.
  private _toggleShowStates() {
    return toggleShowStates(this);
  }

  // Reset the log and everything derived from it. The single place that
  // pairing lives, so a new caller can't reset the lines and forget the rest.
  _clearLogs() {
    this._log.reset();
    this._crashDecode.reset();
    this._crashKind = null;
  }

  // Buffer a streamed line; flushed on the next animation frame. The serial
  // reader (streamSerialToDialog) and the OTA stream both feed through here.
  _enqueueLine(line: string): void {
    this._log.enqueue(line);
  }

  // Every line the buffer takes on, batched or direct, passes through here.
  private _onLinesAppended(lines: readonly string[], start: number): void {
    // One normalization per line, shared by the crash classifier and the
    // decode controller: this runs for every line of a stream that can push
    // thousands a second.
    let kind: CrashKind | null = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const normalized = normalizeLogLine(line);
      this._crashDecode.observe(line, normalized, start + i);
      const lineKind = classifyLine(normalized);
      if (lineKind === "live" || (lineKind && !kind)) kind = lineKind;
    }
    if (this._crashKind !== "live" && kind && kind !== this._crashKind) {
      const firstDetection = this._crashKind === null;
      this._crashKind = kind;
      // The callout shrinks the log container; re-pin so the crash
      // tail stays visible.
      if (firstDetection) {
        void this.updateComplete
          .then(() => this._terminal?.scrollToBottom())
          .catch((err) => console.warn("crash callout re-pin scroll failed", err));
      }
    }
  }

  // Reset Device button (Web Serial only). Pulses RTS (wired to EN on the
  // standard auto-reset circuit) to reboot the device, like the old dashboard's
  // console; the reader stays attached so the boot log follows. Resumes display
  // first so a Stopped log shows the boot output instead of dropping it.
  private _onResetDevice = async () => {
    const s = this._session;
    if (s.kind !== "serial") return;
    this._session = { ...s, paused: false };
    try {
      await s.port.setSignals({ dataTerminalReady: false, requestToSend: true });
      await s.port.setSignals({ dataTerminalReady: false, requestToSend: false });
    } catch {
      // setSignals fails if the cable was pulled; tell the user the reset didn't
      // land rather than letting them assume the device rebooted.
      notifyError(this._localize("dashboard.logs_reset_failed"));
    }
  };

  /**
   * Flip ``_open`` false the moment the user initiates a close (X / Esc /
   * outside-click), before wa-dialog finishes its hide animation. Streamed
   * lines push into the buffer and each push re-renders with
   * ``?open=${this._open}``; were ``_open`` still true mid-animation the
   * re-asserted ``open=true`` could cancel wa-dialog's hide. No
   * ``preventDefault`` — the close proceeds and ``after-hide`` tears down.
   */
  private _onDialogRequestClose = (): void => {
    this._open = false;
  };

  private _onDialogHide() {
    this._open = false;
    void teardownSession(this);
  }

  /**
   * "Back to install" handler — only visible when an ``onBackToInstall``
   * callback was supplied (post-install hand-off). Awaits teardown so the
   * backend subprocess / serial reader is gone before the install dialog
   * re-takes the screen (a fast Back -> Logs -> Back could otherwise leave two
   * subscriptions briefly running), then re-shows the source install dialog.
   */
  private _onBackToInstall = async () => {
    await teardownSession(this);
    const handler = this._backToInstallHandler;
    this._backToInstall = false;
    this._backToInstallHandler = null;
    this._open = false;
    handler?.();
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-logs-dialog": ESPHomeLogsDialog;
  }
}
