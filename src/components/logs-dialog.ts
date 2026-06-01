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
  mdiStop,
} from "@mdi/js";
import { LitElement, html } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
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

  /** Open dialog without auto-starting streaming (for Web Serial feed). */
  /**
   * Register a cancel for the active Web Serial reader so the dialog
   * can tear it down on close or when ``openPassive`` starts a new
   * session. Caller (``streamSerialToDialog``) returns one cancel
   * fn per loop; the dialog only ever holds one at a time and
   * disposes the prior one when a new one is registered.
   */
  public setSerialCancel(cancel: () => void) {
    this._stopSerial();
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
    this._stopSerial();
    this._lines = [...this._lines, message];
    this._streaming = false;
  }

  private _stopSerial() {
    if (this._serialCancel) {
      const cancel = this._serialCancel;
      this._serialCancel = null;
      cancel();
    }
  }

  public openPassive(options: { onBackToInstall?: () => void } = {}) {
    // Tear down any previous Web Serial read loop before kicking off
    // the new session — without this the prior reader keeps shoving
    // bytes into ``_lines`` and the new device's output is mixed
    // with the old one's. Same shape as ``_detachStream`` in
    // command-dialog.ts; different stream type, identical bug.
    this._stopSerial();
    // _port is only consulted if the user hits Stop and then Start
    // after the serial reader is gone — default to OTA so the
    // restart targets the freshly flashed device, not "" (#636).
    this._port = "OTA";
    this._lines = [];
    this._streaming = true;
    this._expanded = false;
    this._showStates = true;
    /* Web Serial drives output directly into ``_lines`` via
       ``streamSerialToDialog`` — there's no backend ``esphome logs``
       subprocess to pass ``--no-states`` to, so the toggle is hidden
       in passive mode to avoid implying state filtering is available. */
    this._passive = true;
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
              ? ""
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
                  onClick: this._stopStreaming,
                })
              : renderTermButton({
                  icon: "play",
                  label: this._localize("dashboard.logs_start"),
                  variant: "start",
                  onClick: this._startStreaming,
                })}
          </div>
        </esphome-process-terminal>
      </esphome-base-dialog>
    `;
  }

  private _startStreaming() {
    // Don't respawn onto a closed dialog: _toggleShowStates awaits stopStream
    // before restarting, and a close during that await would otherwise spawn an
    // orphaned stream with no Stop button. open() sets _open first.
    if (!this._open) return;
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
    // Stop both flavours of stream the dialog can carry: a backend
    // ``logs`` WS subscription and a local Web Serial read loop.
    // Closing one but not the other left passive sessions with a
    // live reader still pushing bytes into ``_lines`` after the
    // user hit Stop / Close.
    this._stopSerial();
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
