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
import { fullscreenMobileDialog } from "../styles/dialog-mobile.js";
import { espHomeStyles } from "../styles/shared.js";
import { downloadAnsiText } from "../util/download-text.js";
import { registerMdiIcons } from "../util/register-icons.js";
import { logsDialogStyles } from "./logs-dialog.styles.js";
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

  @state()
  private _streaming = false;

  @state()
  private _expanded = false;

  @state()
  private _showStates = true;

  @state()
  private _passive = false;

  /**
   * Set when this session was launched as the post-install logs
   * hand-off. Surfaces a "Back to install" button in the toolbar;
   * clicking it stops the stream, closes the dialog, and invokes
   * the supplied callback so the source install dialog (could be
   * either the command-dialog or the firmware-install-dialog) can
   * re-show itself with its preserved state. Reset on every fresh
   * ``open`` / ``openPassive`` so the affordance only appears for
   * the run that asked for it.
   *
   * Callback in the field, boolean in the state — the boolean
   * drives the toolbar render and updates trigger Lit reactivity;
   * the callback closure isn't render-relevant on its own.
   */
  @state()
  private _backToInstall = false;
  private _backToInstallHandler: (() => void) | null = null;

  @state()
  _lines: string[] = [];

  @state()
  private _open = false;

  private _streamId = "";

  /**
   * Cancel handle for an active Web Serial read loop. ``openPassive``
   * runs the loop outside the WS-stream world, so it isn't covered by
   * ``_streamId`` / ``stopStream`` — without an explicit hook the loop
   * survived dialog closes and bled the previous device's output into
   * the next session.
   */
  private _serialCancel: (() => void) | null = null;

  // The Web Serial port backing a passive session. Held for teardown and the
  // Reset Device pulse. The reader stays attached across Stop/Start (see
  // `_serialPaused`) so resuming never reopens the port — a close/reopen
  // pulses DTR/RTS and would reboot the device (#526).
  private _serialPort: SerialPort | null = null;

  // `true` pauses the on-screen log while the reader keeps draining the open
  // port, so Start resumes without a reset. Read by `streamSerialToDialog`.
  _serialPaused = false;

  // Reconnect hook for a passive session whose reader is gone (post-install
  // reopen failed); the "click Start to reconnect" recovery (#636). Normal
  // Stop/Start only pauses/resumes the attached reader and never runs this.
  private _serialReconnect: (() => Promise<void>) | null = null;

  // Reactive mirror of `_serialPort != null` so Reset Device can disable
  // itself while no port is attached instead of being a silent no-op.
  @state() private _hasSerialPort = false;

  @query("esphome-process-terminal")
  private _terminal?: ESPHomeProcessTerminal;

  static styles = [
    espHomeStyles,
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

  private _port = "OTA";

  public open(port = "OTA", options: { onBackToInstall?: () => void } = {}) {
    this._port = port;
    this._lines = [];
    this._streaming = false;
    this._expanded = false;
    /* Reset to the default each open. Persisting "hide states" across
       a close/reopen would surprise the user — the dialog is supposed
       to behave the same way every time it pops up unless the user
       explicitly flips the toggle this session. */
    this._showStates = true;
    this._passive = false;
    // Switching to an OTA / server-serial session: tear down any Web Serial
    // port a previous passive session left open, and drop its reconnect hook.
    this._closeSerial();
    this._serialReconnect = null;
    this._backToInstallHandler = options.onBackToInstall ?? null;
    this._backToInstall = this._backToInstallHandler !== null;
    this._streamId = "";
    this._open = true;
    this._resetAnsiLogScroll();
    this._startStreaming();
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

  /** Register the active Web Serial reader (its loop-cancel) and its port,
   *  tearing down any previous one first. Called by `attachSerialLogStream`.
   *  Leaves `_serialPaused` untouched so a Stop pressed during an in-flight
   *  reconnect is honored rather than overridden by the re-attach. */
  public setSerialStream(port: SerialPort, cancel: () => void) {
    // The attach is async (the reopen path retries for up to 5s). If the dialog
    // was closed or switched to a non-passive session while it was in flight,
    // don't register the stream — tear it down (cancel stops the reader and
    // closes the port) so the handle isn't leaked, leaving the next open() to
    // fail with "already open".
    if (!this._open || !this._passive) {
      cancel();
      return;
    }
    this._closeSerial();
    this._serialPort = port;
    this._hasSerialPort = true;
    this._serialCancel = cancel;
  }

  /**
   * Surface a failure to reopen the Web Serial port for post-install
   * logs. Appends the message into the log pane (so a user who looked
   * away during the install still sees the cause) and flips
   * ``_streaming`` off so the toolbar shows "Start" — the right
   * affordance for "this is broken, try again" — instead of "Stop".
   * The caller pairs this with a ``toast.error`` for at-a-glance
   * surfacing.
   */
  public setSerialOpenFailed(message: string) {
    this._closeSerial();
    this._lines = [...this._lines, message];
    this._streaming = false;
  }

  /** Full teardown: stop the read loop, which also closes the port (the
   *  cancel from `streamSerialToDialog` releases the lock before closing, so
   *  the next open() isn't blocked by a still-open port). For dialog close /
   *  new session / reopen failure. A Stop pause does NOT call this — it only
   *  flips `_serialPaused`, keeping the reader + port alive (#526). */
  private _closeSerial() {
    this._serialPort = null;
    this._hasSerialPort = false;
    if (this._serialCancel) {
      const cancel = this._serialCancel;
      this._serialCancel = null;
      cancel();
    }
  }

  public openPassive(
    options: {
      onBackToInstall?: () => void;
      onReconnect?: () => Promise<void>;
    } = {}
  ) {
    // Tear down any previous Web Serial session (stop the reader and close
    // its port) before kicking off the new one — without this the prior
    // reader keeps shoving bytes into ``_lines`` and the new device's
    // output is mixed with the old one's.
    this._closeSerial();
    // Passive never streams via _port, but keep it a sane default (the header
    // source chip keys off _passive, not this).
    this._port = "OTA";
    this._lines = [];
    this._streaming = true;
    this._serialPaused = false;
    this._expanded = false;
    this._showStates = true;
    /* Web Serial drives output directly into ``_lines`` via
       ``streamSerialToDialog`` — there's no backend ``esphome logs``
       subprocess to pass ``--no-states`` to, so the toggle is hidden
       in passive mode to avoid implying state filtering is available. */
    this._passive = true;
    this._serialReconnect = options.onReconnect ?? null;
    this._backToInstallHandler = options.onBackToInstall ?? null;
    this._backToInstall = this._backToInstallHandler !== null;
    this._streamId = "";
    this._open = true;
    this._resetAnsiLogScroll();
  }

  public close() {
    this._stopStreaming();
    this._open = false;
  }

  protected render() {
    const title = this._localize("dashboard.logs_title", { name: this.name });
    // Web Serial's _port is an unrelated "OTA" fallback, so key off _passive.
    const source = this._passive
      ? this._localize("dashboard.logs_source_web_serial")
      : this._port;
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
          ?streaming=${this._streaming}
        >
          ${this._backToInstall
            ? html`<button
                slot="toolbar-left"
                class="term-btn term-btn--ghost"
                @click=${this._onBackToInstall}
                title=${this._localize("dashboard.logs_back_to_install_tooltip")}
              >
                <wa-icon library="mdi" name="arrow-left"></wa-icon>
                ${this._localize("dashboard.logs_back_to_install")}
              </button>`
            : ""}
          <div class="toolbar-slot" slot="toolbar-right">
            ${this._passive
              ? // Web Serial only; disabled until a port is attached.
                renderTermButton({
                  icon: "restart",
                  label: this._localize("dashboard.logs_reset_device"),
                  disabled: !this._hasSerialPort,
                  onClick: this._onResetDevice,
                })
              : renderTermToggle({
                  active: this._showStates,
                  onClick: this._toggleShowStates,
                  icon: "pulse",
                  label: this._localize("dashboard.logs_states"),
                  title: toggleLabel,
                })}
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
            ${this._streaming
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

  // Start button. The guard absorbs a double-click in the same microtask
  // (the button only renders while not streaming). A passive session with a
  // live reader just un-pauses — no port reopen (DTR/RTS pulse / reset) and
  // no OTA fall-through (#526); if the reader is gone (reopen failed) it runs
  // the reconnect hook instead (#636).
  /** Un-pause a passive session's on-screen log (reader is already draining). */
  private _resumeSerialDisplay() {
    this._serialPaused = false;
    this._streaming = true;
  }

  private _onStart() {
    if (this._streaming) return;
    if (this._passive) {
      if (this._serialCancel) {
        this._resumeSerialDisplay();
        return;
      }
      if (this._serialReconnect) {
        this._streaming = true;
        this._serialReconnect().catch(() => {
          // attach toasts on the reopen-retry path; cover any other rejection
          // here so the click can't fail silently, and reset so Start returns.
          this._streaming = false;
          toast.error(this._localize("dashboard.logs_web_serial_open_failed"), {
            richColors: true,
          });
        });
      }
      return;
    }
    this._startStreaming();
  }

  // Stop button. A passive session pauses display only; the port + reader
  // stay open so Start resumes without a close/reopen that reboots the device
  // (#526). Full close happens on dialog close / new session.
  private _onStop() {
    if (this._passive) {
      this._serialPaused = true;
      this._streaming = false;
      return;
    }
    void this._stopStreaming();
  }

  private _startStreaming() {
    // Don't respawn onto a closed dialog: _toggleShowStates awaits stopStream
    // before restarting, and a close during that await would otherwise spawn an
    // orphaned stream with no Stop button. open() sets _open first.
    if (!this._open) return;
    // Passive Stop/Start go through _onStop / _onStart; guard against an OTA
    // stream ever spawning onto a serial session (#526).
    if (this._passive) return;
    if (this._streaming) return;
    this._streaming = true;

    this._streamId = this._api.logs(
      this.configuration,
      this._port,
      {
        onOutput: (line: string) => {
          this._lines = [...this._lines, line];
        },
        onResult: () => {
          this._streaming = false;
          this._streamId = "";
        },
        onError: () => {
          this._streaming = false;
          this._streamId = "";
        },
      },
      { noStates: !this._showStates }
    );
  }

  private _stopStreaming(): Promise<void> {
    // Full teardown of either stream the dialog carries: the backend WS
    // subscription and a Web Serial session (reader + port). For dialog
    // close / back-to-install — the passive Stop pause goes through _onStop.
    this._closeSerial();
    const streamId = this._streamId;
    this._streaming = false;
    this._streamId = "";
    if (!streamId) return Promise.resolve();
    // Tell the backend to kill the subprocess. If the WS isn't open
    // anymore there's nothing to cancel server-side anyway, so swallow
    // any error from the call. Returns a promise so callers that need
    // to wait for the cancel to land (e.g. the states toggle, which
    // immediately spawns a fresh stream) can await it.
    return this._api
      .stopStream(streamId)
      .catch(() => undefined)
      .then(() => undefined);
  }

  private _downloadLogs() {
    const stem = this.configuration.replace(/\.ya?ml$/, "") || "logs";
    downloadAnsiText(this._lines, `${stem}-logs.txt`);
  }

  private _toggleExpanded() {
    this._expanded = !this._expanded;
  }

  private async _toggleShowStates() {
    this._showStates = !this._showStates;
    /* The --no-states flag is set on the esphome subprocess at spawn
       time, so flipping the toggle has to tear down the current
       stream and start a fresh one. Await the cancel so the backend
       has actually killed the old subprocess before we spawn the new
       one — otherwise a fast double-toggle could leave two log
       readers attached to the device API at once. Only restart if we
       were actively streaming — if the user already hit Stop, leave
       the buffer alone and let them hit Start themselves. */
    if (!this._streamId) return;
    await this._stopStreaming();
    this._startStreaming();
  }

  private _clearLogs() {
    this._lines = [];
  }

  // Reset Device button (Web Serial only). Pulses RTS (wired to EN on the
  // standard auto-reset circuit) to reboot the device, like the old
  // dashboard's console; the reader stays attached so the boot log follows.
  private _onResetDevice = async () => {
    const port = this._serialPort;
    if (!port) return;
    // Resume the log first (if Stopped) so the boot output the reset produces
    // is shown rather than dropped into a paused view.
    this._resumeSerialDisplay();
    try {
      await port.setSignals({ dataTerminalReady: false, requestToSend: true });
      await port.setSignals({ dataTerminalReady: false, requestToSend: false });
    } catch {
      // setSignals fails if the cable was pulled; tell the user the reset
      // didn't land rather than letting them assume the device rebooted.
      toast.error(this._localize("dashboard.logs_reset_failed"), { richColors: true });
    }
  };

  /**
   * Flip our local ``_open`` flag the moment the user
   * initiates a close (X / Esc / outside-click), before
   * wa-dialog finishes its hide animation. Log streaming
   * pushes new lines into ``_lines`` on a continuous WS
   * subscription, and each push triggers a re-render with
   * ``?open=${this._open}`` — if ``_open`` were still
   * ``true`` during the hide animation, the re-asserted
   * ``open=true`` could cancel wa-dialog's in-progress
   * hide. Doesn't ``preventDefault`` — no host-side veto
   * reason — so the close still proceeds and the
   * ``after-hide`` handler tears down the stream as
   * before.
   */
  private _onDialogRequestClose = (): void => {
    this._open = false;
  };

  private _onDialogHide() {
    this._open = false;
    this._stopStreaming();
  }

  /**
   * "Back to install" handler — only visible when an ``onBackToInstall``
   * callback was supplied to ``open`` / ``openPassive`` (post-install
   * hand-off). Stops the live stream, closes this dialog, and invokes
   * the supplied callback to re-show the source install dialog with
   * its preserved state.
   *
   * Awaits ``_stopStreaming`` so the backend log subprocess has
   * actually torn down before the install dialog re-takes the
   * screen. Without the await, a fast ``Back → Logs → Back → Logs``
   * toggle by the user could leave two backend log subscriptions
   * running briefly, both pumping lines into the same buffer. */
  private _onBackToInstall = async () => {
    await this._stopStreaming();
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
