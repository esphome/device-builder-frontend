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
import { LitElement, html } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import toast from "sonner-js";
import type { ESPHomeAPI } from "../api/index.js";
import type { LocalizeFunc } from "../common/localize.js";
import { apiContext, darkModeContext, localizeContext } from "../context/index.js";
import { primaryDialogHeaderStyles } from "../styles/dialog-header.js";
import { fullscreenMobileDialog } from "../styles/dialog-mobile.js";
import { espHomeStyles } from "../styles/shared.js";
import { configurationStem, downloadAnsiText } from "../util/download-text.js";
import { registerMdiIcons } from "../util/register-icons.js";
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

@customElement("esphome-logs-dialog")
export class ESPHomeLogsDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: darkModeContext, subscribe: true })
  @state()
  private _darkMode = true;

  @consume({ context: apiContext })
  private _api!: ESPHomeAPI;

  @property()
  configuration = "";

  @property()
  name = "";

  // The active log source + its lifecycle. Single source of truth; the toolbar
  // (streaming dot, Stop/Start, Reset enablement, source chip) all derive from
  // it. See logs-session.ts for the states and why they're a union.
  @state() private _session: LogsSession = { kind: "idle" };

  @state()
  private _expanded = false;

  @state()
  private _showStates = true;

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
  private _backToInstall = false;
  private _backToInstallHandler: (() => void) | null = null;

  // Reconnect hook for a Web Serial session whose reader is gone (a reopen
  // failed -> `dead`); the "click Start to reconnect" recovery (#636).
  private _reconnect: (() => Promise<void>) | null = null;

  @state()
  _lines: string[] = [];

  @state()
  private _open = false;

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
    this._beginSession(options.onBackToInstall);
    this._reconnect = null;
    this._session = { kind: "ota", port, streamId: null };
    this._open = true;
    this._resetAnsiLogScroll();
    // Not awaiting the teardown in _beginSession (unlike _toggleShowStates):
    // open() is only reached after a close, so any prior session is already
    // idle and the teardown is a no-op — there's no live stream to overlap.
    this._startOtaStream();
  }

  public openPassive(options: {
    // Required so the `dead` state (a reopen failure) always has a recovery
    // path — Start re-runs it; otherwise the Start button would be a dead end.
    onReconnect: () => Promise<void>;
    onBackToInstall?: () => void;
  }) {
    this._beginSession(options.onBackToInstall);
    this._reconnect = options.onReconnect;
    // The attach (`attachSerialLogStream` -> `setSerialStream`) follows
    // immediately; show it as connecting/streaming until the reader lands.
    this._session = { kind: "reconnecting", paused: false };
    this._open = true;
    this._resetAnsiLogScroll();
  }

  /** Shared open/openPassive prologue: tear down any prior session and reset
   *  the per-session view state. ``_showStates`` resets each open so the dialog
   *  behaves the same way every time unless the user flips it this session. */
  private _beginSession(onBackToInstall?: () => void) {
    void this._teardownSession();
    this._lines = [];
    this._expanded = false;
    this._showStates = true;
    this._backToInstallHandler = onBackToInstall ?? null;
    this._backToInstall = this._backToInstallHandler !== null;
  }

  private _resetAnsiLogScroll() {
    /* The ansi-log instance is reused across opens. If the user
       scrolled up in a previous session its ``_isUserScrolled`` flag
       is still true, which suppresses auto-scroll for the new
       session — incoming lines pile up unseen until the user scrolls
       back to the bottom themselves. ``scrollToBottom()`` clears the
       flag and forces a scroll. updateComplete makes sure the @query
       has resolved on first open. */
    this.updateComplete.then(() => this._terminal?.scrollToBottom());
  }

  /** Register the Web Serial reader (its loop-cancel) + port. Called by
   *  `attachSerialLogStream` once a port is open and streaming. */
  public setSerialStream(port: SerialPort, cancel: () => void) {
    // The attach is async (the reopen path retries for up to 5s). If the dialog
    // closed or switched to a non-passive session while it was in flight, don't
    // register — tear it down (cancel stops the reader and closes the port) so
    // the handle isn't leaked, leaving the next open() to fail "already open".
    if (!this._open || !isPassive(this._session)) {
      cancel();
      return;
    }
    // Honor a Stop pressed during the in-flight attach; replace any prior
    // reader (defensive — `reconnecting` holds none).
    const paused = this._session.kind === "reconnecting" ? this._session.paused : false;
    if (this._session.kind === "serial") this._session.cancel();
    this._session = { kind: "serial", port, cancel, paused };
  }

  /**
   * Surface a failure to reopen the Web Serial port for post-install logs.
   * Appends the message into the log pane (so a user who looked away during the
   * install still sees the cause) and drops to ``dead`` so the toolbar shows
   * "Start" — clicking it re-runs the reconnect hook. The caller pairs this
   * with a ``toast.error``.
   */
  public setSerialOpenFailed(message: string) {
    // Same guard as setSerialStream: the reopen retries for ~5s, so a late
    // failure can land after the dialog closed or switched to an OTA session —
    // don't tear that unrelated session down or flip it into a passive `dead`.
    if (!this._open || !isPassive(this._session)) return;
    void this._teardownSession();
    this._lines = [...this._lines, message];
    this._session = { kind: "dead" };
  }

  /** Stop whatever the session is running (Web Serial reader -> closes the
   *  port; backend WS -> kills the subprocess) and return to ``idle``. The
   *  cancel from `streamSerialToDialog` releases the reader lock before closing
   *  so the next open() isn't blocked by a still-open port. A Stop *pause*
   *  doesn't call this — it keeps the reader + port alive (#526). */
  private _teardownSession(): Promise<void> {
    const s = this._session;
    this._session = { kind: "idle" };
    if (s.kind === "serial") {
      s.cancel();
      return Promise.resolve();
    }
    if (s.kind === "ota" && s.streamId !== null) {
      return this._stopBackendStream(s.streamId);
    }
    return Promise.resolve();
  }

  private _stopBackendStream(streamId: string): Promise<void> {
    // Swallow errors: if the WS is already gone there's nothing to cancel
    // server-side. Returns a promise so callers that immediately respawn (the
    // states toggle) can await the cancel landing first.
    return this._api
      .stopStream(streamId)
      .catch(() => undefined)
      .then(() => undefined);
  }

  public close() {
    void this._teardownSession();
    this._open = false;
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
        <span slot="header-suffix" class="source-chip" title=${source}>${source}</span>
        <esphome-process-terminal
          .lines=${this._lines}
          placeholder=${this._localize("dashboard.logs_placeholder")}
          ?light=${!this._darkMode}
          ?streaming=${streaming}
        >
          ${this._backToInstall
            ? html`<button
                slot="toolbar-left"
                class="term-btn term-btn--ghost"
                @click=${this._onBackToInstall}
                title=${this._localize("dashboard.logs_back_to_install_tooltip")}
              >
                <wa-icon library="mdi" name="arrow-left"></wa-icon>
                <span class="term-btn__label"
                  >${this._localize("dashboard.logs_back_to_install")}</span
                >
              </button>`
            : ""}
          <div class="toolbar-slot" slot="toolbar-right">
            ${passive
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
                : ""}
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
            ${streaming
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
                })}
          </div>
        </esphome-process-terminal>
      </esphome-base-dialog>
    `;
  }

  // Start button (only shown while not streaming; the leading guard also
  // absorbs a double-click in the same microtask). Per state:
  //  - ota (stopped): respawn the backend stream.
  //  - serial / reconnecting: just un-pause display — no port reopen (no
  //    DTR/RTS pulse / reset) and no second reconnect while one's in flight.
  //  - dead: run the reconnect hook (#636).
  private _onStart() {
    const s = this._session;
    if (isStreaming(s)) return;
    switch (s.kind) {
      case "ota":
        this._startOtaStream();
        break;
      case "serial":
      case "reconnecting":
        this._session = { ...s, paused: false };
        break;
      case "dead":
        this._reconnectSerial();
        break;
    }
  }

  // Stop button. OTA kills the subprocess (Start respawns it); a Web Serial
  // session only pauses display — the port + reader stay open so Start resumes
  // without a close/reopen that reboots the device (#526).
  private _onStop() {
    const s = this._session;
    switch (s.kind) {
      case "ota":
        if (s.streamId !== null) {
          this._session = { kind: "ota", port: s.port, streamId: null };
          void this._stopBackendStream(s.streamId);
        }
        break;
      case "serial":
      case "reconnecting":
        this._session = { ...s, paused: true };
        break;
    }
  }

  private _startOtaStream() {
    const s = this._session;
    // Don't respawn onto a closed dialog (a close during the states-toggle
    // cancel await would otherwise orphan a stream); only spawn from a stopped
    // OTA session.
    if (!this._open || s.kind !== "ota" || s.streamId !== null) return;
    // Tag the stop callbacks with this stream's id so a late onResult/onError
    // from a torn-down stream can't stop the one that replaced it. (The API
    // also drops a stopped stream's handler synchronously, so this is belt +
    // braces — it keeps correctness local instead of relying on that.)
    let streamId = "";
    streamId = this._api.logs(
      this.configuration,
      s.port,
      {
        onOutput: (line: string) => {
          this._lines = [...this._lines, line];
        },
        onResult: () => this._markOtaStopped(streamId),
        onError: () => this._markOtaStopped(streamId),
      },
      { noStates: !this._showStates }
    );
    this._session = { kind: "ota", port: s.port, streamId };
  }

  private _markOtaStopped(streamId: string) {
    const s = this._session;
    if (s.kind === "ota" && s.streamId === streamId) {
      this._session = { kind: "ota", port: s.port, streamId: null };
    }
  }

  private _reconnectSerial() {
    if (!this._reconnect) return;
    this._session = { kind: "reconnecting", paused: false };
    this._reconnect().catch(() => {
      // The reopen-retry failure path handles itself (setSerialOpenFailed ->
      // `dead`, with its own toast). Only surface genuinely-unhandled
      // rejections — still `reconnecting` means attach didn't handle it — so we
      // don't double-toast.
      if (this._session.kind !== "reconnecting") return;
      this._session = { kind: "dead" };
      toast.error(this._localize("dashboard.logs_web_serial_open_failed"), {
        richColors: true,
      });
    });
  }

  private _downloadLogs() {
    const stem = configurationStem(this.configuration, "logs");
    downloadAnsiText(this._lines, `${stem}-logs.txt`);
  }

  private _toggleExpanded() {
    this._expanded = !this._expanded;
  }

  private async _toggleShowStates() {
    this._showStates = !this._showStates;
    /* The --no-states flag is baked into the esphome subprocess at spawn time,
       so flipping the toggle tears the stream down and respawns it. Await the
       cancel so the backend has killed the old subprocess before the new one
       spawns (a fast double-toggle would otherwise leave two readers on the
       device API). Only while actively streaming — if the user already hit
       Stop, leave the buffer and let them Start themselves. */
    const s = this._session;
    if (s.kind !== "ota" || s.streamId === null) return;
    this._session = { kind: "ota", port: s.port, streamId: null };
    await this._stopBackendStream(s.streamId);
    this._startOtaStream();
  }

  private _clearLogs() {
    this._lines = [];
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
      toast.error(this._localize("dashboard.logs_reset_failed"), { richColors: true });
    }
  };

  /**
   * Flip ``_open`` false the moment the user initiates a close (X / Esc /
   * outside-click), before wa-dialog finishes its hide animation. Streamed
   * lines push into ``_lines`` and each push re-renders with
   * ``?open=${this._open}``; were ``_open`` still true mid-animation the
   * re-asserted ``open=true`` could cancel wa-dialog's hide. No
   * ``preventDefault`` — the close proceeds and ``after-hide`` tears down.
   */
  private _onDialogRequestClose = (): void => {
    this._open = false;
  };

  private _onDialogHide() {
    this._open = false;
    void this._teardownSession();
  }

  /**
   * "Back to install" handler — only visible when an ``onBackToInstall``
   * callback was supplied (post-install hand-off). Awaits teardown so the
   * backend subprocess / serial reader is gone before the install dialog
   * re-takes the screen (a fast Back -> Logs -> Back could otherwise leave two
   * subscriptions briefly running), then re-shows the source install dialog.
   */
  private _onBackToInstall = async () => {
    await this._teardownSession();
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
