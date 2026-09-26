import { consume } from "@lit/context";
import {
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
import { html, LitElement } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { ESPHomeAPI } from "../api/index.js";
import type { ConfiguredDevice } from "../api/types/devices.js";
import { OTA_PORT } from "../api/types/streaming.js";
import type { LocalizeFunc } from "../common/localize.js";
import {
  apiConnectedContext,
  apiConnectionLostContext,
  apiContext,
  darkModeContext,
  devicesContext,
  localizeContext,
} from "../context/index.js";
import { platformFor } from "../platforms/registry.js";
import { primaryDialogHeaderStyles } from "../styles/dialog-header.js";
import { fullscreenMobileDialog } from "../styles/dialog-mobile.js";
import { espHomeStyles } from "../styles/shared.js";
import { textStyles } from "../styles/text.js";
import { classifyLine, type CrashKind, latchCrashKind } from "../util/crash-detector.js";
import { resolveDevicePlatform } from "../util/crash-report.js";
import { initialDarkMode } from "../util/dark-mode.js";
import { configurationStem, downloadAnsiText } from "../util/download-text.js";
import { LogBuffer } from "../util/log-buffer.js";
import { normalizeLogLine } from "../util/log-line.js";
import { QuietTimerController } from "../util/quiet-timer-controller.js";
import { registerMdiIcons } from "../util/register-icons.js";
import { CrashDecodeController } from "./crash-decode-controller.js";
import type { ESPHomeCrashReportDialog } from "./crash-report-dialog.js";
import { logsDialogStyles } from "./logs-dialog.styles.js";
import type { SerialResetHook } from "./logs-dialog/session.js";
import {
  abortSerialReconnect,
  beginClose,
  markSerialOutput,
  onStart,
  onStop,
  openOta,
  openPassive,
  resetSerialDevice,
  resumeAfterReconnect,
  setBleStream,
  setSerialOpenFailed,
  setSerialStream,
  switchToOtaLogs,
  teardownSession,
  toggleShowStates,
} from "./logs-dialog/session.js";
import { renderLogsToolbar } from "./logs-dialog/toolbar.js";
import {
  hasPause,
  isPassive,
  isStreaming,
  type LogsSession,
  type PassiveSource,
} from "./logs-session.js";
import {
  crashCalloutStyles,
  renderCrashCallout,
  repinTerminalForCallout,
} from "./process-terminal/crash-callout.js";
import type { ESPHomeProcessTerminal } from "./process-terminal/process-terminal.js";
import {
  fillTerminalOnMobile,
  termButtonStyles,
  termSuggestionStyles,
  termTokens,
} from "./process-terminal/process-terminal.styles.js";
import { renderActionSuggestion } from "./process-terminal/reset-suggestion.js";
import { renderTermButton } from "./process-terminal/toolbar-button.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "./base-dialog.js";
import "./crash-report-dialog.js";
import "./process-terminal/process-terminal.js";

registerMdiIcons({
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

// How long a freshly attached Web Serial reader may show nothing before the
// dialog offers network logs instead. Long enough for a normal boot's first
// line; short enough that a dead-end console (uart: on the console pins,
// #1430) doesn't strand the user staring at the placeholder.
const QUIET_SERIAL_TIMEOUT_MS = 5000;

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

  /** WS liveness; the false→true edge resumes a stream the drop
   *  stopped. */
  @consume({ context: apiConnectedContext, subscribe: true })
  @state()
  _apiConnected = true;

  /** Gated connection-lost indicator; drives the banner. */
  @consume({ context: apiConnectionLostContext, subscribe: true })
  @state()
  _connectionLost = false;

  // Resolves the streamed device's platform for platform-gated doc links.
  @consume({ context: devicesContext, subscribe: true })
  @state()
  _devices: ConfiguredDevice[] = [];

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
  _reconnect: ((cancelled: () => boolean) => Promise<void>) | null = null;
  // Session-supplied Reset Device (a Pico's BOOTSEL round trip); without it
  // Reset Device is the RTS pulse, offered only where that works.
  _resetDevice: SerialResetHook | null = null;
  // Bumped per open; see runReconnecting.
  _sessionGen = 0;

  // Watchdog for a Web Serial reader that shows nothing (uart: repurposed
  // the console pins, wrong baud). Armed/disarmed off the session state in
  // willUpdate; a fired banner counts as armed, so expectSerialOutput drops
  // it before rebuilding the session. When it goes quiet the toolbar area
  // offers switching to network logs (#1430).
  _quietSerial = new QuietTimerController(this, QUIET_SERIAL_TIMEOUT_MS);

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

  // Read by the stream line hooks to gate appends while the log is paused.
  get _serialPaused(): boolean {
    const s = this._session;
    return hasPause(s) && s.paused;
  }

  // Derived in willUpdate, not per render: the dialog re-renders per frame
  // while streaming and the device list can be long.
  private _targetPlatform = "";
  // The RTS-pulse Reset Device works unless the platform's logs policy says
  // its port has no reset line (Pico, nRF52: the pulse's DTR drop only
  // detaches the host); a Pico resets through the session's hook instead.
  _pulseResets = true;
  // Set by openPassive; see PassiveSource.
  _passiveSource: PassiveSource = "serial";

  static styles = [
    espHomeStyles,
    primaryDialogHeaderStyles,
    termTokens,
    termButtonStyles,
    termSuggestionStyles,
    textStyles,
    crashCalloutStyles,
    logsDialogStyles,
    // Full-screen on mobile, terminal fills it.
    fullscreenMobileDialog("esphome-base-dialog"),
    fillTerminalOnMobile,
  ];

  protected willUpdate(changedProperties: Map<string, unknown>) {
    if (changedProperties.has("_darkMode")) {
      this.toggleAttribute("light", !this._darkMode);
    }
    if (changedProperties.has("configuration") || changedProperties.has("_devices")) {
      this._targetPlatform = resolveDevicePlatform(this._devices, this.configuration);
      // ESP (no descriptor) keeps the RTS pulse.
      this._pulseResets =
        platformFor(this._targetPlatform)?.logs?.serial?.pulseResets ?? true;
    }
    if (changedProperties.has("_expanded")) {
      this.toggleAttribute("expanded", this._expanded);
    }
    if (changedProperties.has("_session") || changedProperties.has("_open")) {
      // Every session transition flows through logs-dialog/session.ts and
      // replaces _session, so keying here covers open/attach/pause/teardown
      // without touching each transition. Only a live reader that has yet
      // to show a line arms: the reconnecting phase is the settle delay +
      // reopen retries (several seconds on a re-enumerating native-USB
      // chip), which isn't silence — and a failed reopen lands in dead,
      // which offers the banner anyway. A deliberate Stop (pause, #526)
      // disarms rather than counting as silence.
      const s = this._session;
      const watching = this._open && s.kind === "serial" && !s.paused && !s.outputSeen;
      if (watching) this._quietSerial.ensureArmed();
      else this._quietSerial.disarm();
    }
    // A Web Serial session reads USB, not the dashboard WS; the
    // connection banner and the resume are ota-only.
    if (changedProperties.has("_connectionLost") && this._session.kind === "ota") {
      // The banner toggling resizes the log area on both edges;
      // re-pin the scroll so the tail stays visible.
      this._resetAnsiLogScroll();
    }
    if (changedProperties.has("_apiConnected") && this._session.kind === "ota") {
      if (this._apiConnected) resumeAfterReconnect(this);
    }
  }

  public open(port = OTA_PORT, options: { onBackToInstall?: () => void } = {}) {
    openOta(this, port, options);
  }

  /** Returns the cancel predicate for this session's own attach. */
  public openPassive(options: {
    onReconnect: (cancelled: () => boolean) => Promise<void>;
    onBackToInstall?: () => void;
    onResetDevice?: SerialResetHook;
    source?: PassiveSource;
  }): () => boolean {
    return openPassive(this, options);
  }

  /** Register a streaming BLE NUS link once notifications flow. */
  public setBleStream(cancel: () => Promise<void>) {
    setBleStream(this, cancel);
  }

  /** Register the Web Serial reader (its loop-cancel) + port. Called by
   *  `attachSerialLogStream` once a port is open and streaming. */
  public setSerialStream(port: SerialPort, cancel: () => Promise<void>) {
    setSerialStream(this, port, cancel);
  }

  /** End the passive session for *message* (shown in the pane); Start reconnects. */
  public setSerialOpenFailed(message: string) {
    setSerialOpenFailed(this, message);
  }

  /** Return an in-flight reconnect to ``dead`` without surfacing an error. */
  public abortSerialReconnect() {
    abortSerialReconnect(this);
  }

  /** Swap the current Web Serial session for the network stream in place,
   *  keeping the log buffer and the back-to-install affordance. A *reason*
   *  is appended to the pane ahead of the switch line. */
  public switchToNetworkLogs(reason?: string) {
    switchToOtaLogs(this, reason);
  }

  public close() {
    beginClose(this);
  }

  _resetAnsiLogScroll() {
    /* The ansi-log instance is reused across opens. If the user
       scrolled up in a previous session its ``_isUserScrolled`` flag
       is still true, which suppresses auto-scroll for the new
       session — incoming lines pile up unseen until the user scrolls
       back to the bottom themselves. ``scrollToBottom()`` clears the
       flag and forces a scroll. updateComplete makes sure the @query
       has resolved on first open. */
    void this.updateComplete.then(() => this._terminal?.scrollToBottom());
  }

  // A passive session shows its source; OTA / server-serial show the port.
  private _sourceLabel(): string {
    const s = this._session;
    if (isPassive(s)) {
      return this._localize(
        this._passiveSource === "ble"
          ? "dashboard.logs_source_ble_nus"
          : "dashboard.logs_source_web_serial"
      );
    }
    return s.kind === "ota" ? s.port : "";
  }

  protected render() {
    const s = this._session;
    const streaming = isStreaming(s);
    // The dead state (serial reopen failed) gets the escape hatch — but not
    // for BLE sessions: OTA logs don't apply to nRF52, and the message
    // "Serial isn't available" is wrong for a Bluetooth disconnect.
    const isBle = this._passiveSource === "ble";
    const offerOtaFallback = !isBle && (this._quietSerial.quiet || s.kind === "dead");
    const title = this._localize("dashboard.logs_title", { name: this.name });
    const source = this._sourceLabel();
    // The BLE connect can take seconds with nothing to show yet.
    const connectingMessage =
      s.kind === "reconnecting" && this._passiveSource === "ble"
        ? this._localize("dashboard.logs_ble_nus_connecting")
        : "";
    // Only the ota source rides the dashboard WS; a Web Serial stream
    // is healthy regardless, so no false error banner there.
    const wsDown = s.kind === "ota" && this._connectionLost;

    return html`
      <esphome-base-dialog
        ?open=${this._open}
        .label=${title}
        @request-close=${this._onDialogRequestClose}
      >
        <span slot="header-suffix" class="source-chip truncate" title=${source}
          >${source}</span
        >
        <esphome-process-terminal
          .lines=${this._log.lines}
          placeholder=${this._localize("dashboard.logs_placeholder")}
          .targetPlatform=${this._targetPlatform}
          ?light=${!this._darkMode}
          ?streaming=${streaming}
          .state=${connectingMessage ? "running" : null}
          .statusMessage=${connectingMessage}
          .connectionLost=${wsDown}
          .connectionLostMessage=${this._localize("dashboard.logs_connection_lost")}
        >
          ${
            this._backToInstall
              ? html`<div class="toolbar-slot" slot="toolbar-left">
                  ${renderTermButton({
                    icon: "arrow-left",
                    label: this._localize("dashboard.logs_back_to_install"),
                    title: this._localize("dashboard.logs_back_to_install_tooltip"),
                    onClick: () => void this._onBackToInstall(),
                  })}
                </div>`
              : ""
          }
          ${renderCrashCallout(
            this._localize,
            this._crashKind,
            html`<button
              type="button"
              class="term-btn crash-callout-button"
              @click=${this._openCrashReport}
            >
              ${this._localize("crash_report.report_button")}
            </button>`
          )}
          ${
            offerOtaFallback
              ? renderActionSuggestion(
                  this._localize,
                  // dead is a reopen failure / dismissed picker, not a silent
                  // console — don't diagnose "no output" there.
                  s.kind === "dead"
                    ? "dashboard.logs_serial_unavailable"
                    : "dashboard.logs_no_serial_output",
                  "{network_action}",
                  "dashboard.logs_switch_to_network",
                  () => switchToOtaLogs(this)
                )
              : ""
          }
          ${renderLogsToolbar(this)}
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

  _onStart() {
    onStart(this);
  }

  _onStop() {
    onStop(this);
  }

  _downloadLogs() {
    this._log.flush();
    const stem = configurationStem(this.configuration, "logs");
    downloadAnsiText(this._log.lines, `${stem}-logs.txt`);
  }

  _toggleExpanded() {
    this._expanded = !this._expanded;
  }

  // Returns the restart so a caller can await the respawn landing.
  _toggleShowStates() {
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

  // Called by `streamSerialToDialog` for every displayed serial line.
  _noteSerialActivity(): void {
    markSerialOutput(this);
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
    const next = latchCrashKind(this._crashKind, kind);
    if (next !== this._crashKind) {
      const firstDetection = this._crashKind === null;
      this._crashKind = next;
      if (firstDetection) {
        repinTerminalForCallout(this.updateComplete, () => this._terminal);
      }
    }
  }

  // Reset Device button (Web Serial only).
  _onResetDevice = () => resetSerialDevice(this);

  /**
   * Flip ``_open`` false the moment the user initiates a close (X / Esc /
   * outside-click), before wa-dialog finishes its hide animation. Streamed
   * lines push into the buffer and each push re-renders with
   * ``?open=${this._open}``; were ``_open`` still true mid-animation the
   * re-asserted ``open=true`` could cancel wa-dialog's hide. No
   * ``preventDefault`` — the close proceeds; the session ends with it.
   */
  private _onDialogRequestClose = (): void => beginClose(this);

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
    beginClose(this);
    handler?.();
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-logs-dialog": ESPHomeLogsDialog;
  }
}
