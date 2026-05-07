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
import { LitElement, css, html } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { ESPHomeAPI } from "../api/index.js";
import type { LocalizeFunc } from "../common/localize.js";
import type { ESPHomeAnsiLog } from "./ansi-log.js";
import { apiContext, darkModeContext, localizeContext } from "../context/index.js";
import { dialogCloseButtonStyles } from "../styles/dialog-close-button.js";
import { espHomeStyles } from "../styles/shared.js";
import { downloadAnsiText } from "../util/download-text.js";
import { registerMdiIcons } from "../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/dialog/dialog.js";
import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "./ansi-log.js";

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

  private _streamId = "";

  /**
   * Cancel handle for an active Web Serial read loop. ``openPassive``
   * runs the loop outside the WS-stream world, so it isn't covered by
   * ``_streamId`` / ``stopStream`` — without an explicit hook the loop
   * survived dialog closes and bled the previous device's output into
   * the next session.
   */
  private _serialCancel: (() => void) | null = null;

  @query("wa-dialog")
  private _dialog!: HTMLElement & { open: boolean };

  @query("esphome-ansi-log")
  private _ansiLog?: ESPHomeAnsiLog;

  static styles = [
    espHomeStyles,
    dialogCloseButtonStyles,
    css`
      :host {
        --term-bg: #1e1e1e;
        --term-bg-alt: #252526;
        --term-fg: #d4d4d4;
        --term-fg-muted: #808080;
        --term-border: #3c3c3c;
        --term-hover: #2a2d2e;
        --term-accent: #4ec9b0;
        --term-error: #f44747;
      }

      :host([light]) {
        --term-bg: #f5f5f5;
        --term-bg-alt: #e8e8e8;
        --term-fg: #1e1e1e;
        --term-fg-muted: #6e6e6e;
        --term-border: #d0d0d0;
        --term-hover: #dcdcdc;
        --term-accent: #0d8a6f;
        --term-error: #c02020;
      }

      wa-dialog {
        /* Width history: 900 wrapped, 1100 still ~100px short, 1200
           still wrapped on retina / HiDPI screens where ESPHome's
           ANSI-coloured output reads at a slightly larger glyph and
           the timestamp + [C][module:NNN] prefix eats more
           horizontal real estate than expected. 1300 fits the
           common case end-to-end on a 13-inch laptop and leaves the
           expand button as the answer for long-tail lines
           (multi-component config dumps, stack traces) past ~150
           columns. min(..., 94vw) keeps the dialog from kissing the
           viewport edges on smaller screens. */
        --width: min(1300px, 94vw);
      }

      /* Expanded → "just give me logs": full viewport, the body fills
         the space between the slim title bar and the streaming/stop
         toolbar. height: 100% (with min-height: 0 so flex children
         can shrink) lets the dialog's intrinsic header/body/footer
         flex layout do the math, which avoids the calc(100dvh - X)
         guesswork that left ~200px of empty space under the toolbar.
         Same shape the mobile rule below already uses. */
      :host([expanded]) .logs-content {
        height: 100%;
        max-height: none;
        min-height: 0;
      }

      /* Match the device-editor's title bar (--esphome-primary
         background with --esphome-on-primary text) so the dialog
         reads as part of the dashboard chrome. The body stays
         terminal-themed — header colour was the only thing that
         looked unintentional against the dashboard's blue header
         bar. */
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
        font-family: "SF Mono", "Fira Code", "Fira Mono", "Cascadia Code", monospace;
      }

      /* Close-button styling lives in
         src/styles/dialog-close-button.ts — see the
         dialogCloseButtonStyles import below. */

      wa-dialog::part(body) {
        padding: 0;
        background: var(--term-bg);
        overflow: hidden;
      }

      wa-dialog::part(footer) {
        display: none;
      }

      .logs-content {
        display: flex;
        flex-direction: column;
        height: 60vh;
        min-height: 300px;
        max-height: 70vh;
        overflow: hidden;
      }

      esphome-ansi-log {
        flex: 1;
        min-height: 0;
        --log-height: 100%;
      }

      /* Override ansi-log border-radius inside the dialog */
      esphome-ansi-log::part(container) {
        border-radius: 0;
      }

      .terminal-toolbar {
        flex-shrink: 0;
        display: flex;
        align-items: center;
        gap: var(--wa-space-xs);
        padding: 6px var(--wa-space-m);
        background: var(--term-bg-alt);
        border-top: 1px solid var(--term-border);
      }

      .terminal-toolbar .spacer {
        flex: 1;
      }

      .term-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 5px;
        padding: 4px 12px;
        border-radius: 4px;
        font-size: 12px;
        font-weight: 600;
        font-family: "SF Mono", "Fira Code", monospace;
        cursor: pointer;
        border: 1px solid var(--term-border);
        transition:
          background 0.1s,
          border-color 0.1s;
      }

      .term-btn wa-icon {
        font-size: 14px;
      }

      .term-btn--ghost {
        background: transparent;
        color: var(--term-fg-muted);
      }

      .term-btn--ghost:hover {
        background: var(--term-hover);
        color: var(--term-fg);
        border-color: var(--term-fg-muted);
      }

      /* Tint the states toggle with the accent palette while the
         "show states" mode is on so the user can tell at a glance
         whether component state lines are flowing. Same palette as
         --start so it visually reads as "this is active". */
      .term-btn--ghost.is-active {
        background: color-mix(in srgb, var(--term-accent), transparent 85%);
        color: var(--term-accent);
        border-color: color-mix(in srgb, var(--term-accent), transparent 60%);
      }

      .term-btn--start {
        background: color-mix(in srgb, var(--term-accent), transparent 85%);
        color: var(--term-accent);
        border-color: color-mix(in srgb, var(--term-accent), transparent 60%);
      }

      .term-btn--start:hover {
        background: color-mix(in srgb, var(--term-accent), transparent 75%);
      }

      .term-btn--stop {
        background: color-mix(in srgb, var(--term-error), transparent 85%);
        color: var(--term-error);
        border-color: color-mix(in srgb, var(--term-error), transparent 60%);
      }

      .term-btn--stop:hover {
        background: color-mix(in srgb, var(--term-error), transparent 75%);
      }

      .streaming-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--term-accent);
        animation: pulse 1.5s infinite;
      }

      @keyframes pulse {
        0%,
        100% {
          opacity: 1;
        }
        50% {
          opacity: 0.3;
        }
      }

      /* Full-viewport rules — the same shape applies when the user
         hits expand on desktop AND on any mobile width. Placed last
         so same-specificity rules in this file win source-order
         against the desktop defaults. The :host wa-dialog::part(dialog)
         selector lands at (0,1,2), beating both wa-dialog's internal
         .dialog (0,1,0) and the user-agent's dialog:modal (0,1,1)
         without needing !important. */
      :host([expanded]) wa-dialog::part(dialog) {
        position: fixed;
        inset: 0;
        width: 100vw;
        height: 100vh;
        height: 100dvh;
        max-width: none;
        max-height: none;
        margin: 0;
        border-radius: 0;
      }

      @media (max-width: 700px) {
        :host wa-dialog::part(dialog) {
          position: fixed;
          inset: 0;
          /* width/height are explicit because wa-dialog's
             width: var(--width) and the UA's
             max-height: calc(100% - ...) would otherwise keep the
             dialog at its desktop size. The vh declaration is the
             fallback for pre-2022 Safari / Chrome / Firefox that
             don't recognise dvh; modern browsers pick the dvh line
             which adjusts as iOS Safari's URL bar collapses. */
          width: 100vw;
          height: 100vh;
          height: 100dvh;
          max-width: none;
          max-height: none;
          margin: 0;
          border-radius: 0;
        }

        .logs-content {
          height: 100%;
          max-height: none;
          min-height: 0;
        }

        .term-btn.expand-btn {
          display: none;
        }
      }
    `,
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
    this._dialog.open = true;
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
    this.updateComplete.then(() => this._ansiLog?.scrollToBottom());
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
    this._port = "";
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
    this._dialog.open = true;
    this._resetAnsiLogScroll();
  }

  public close() {
    this._stopStreaming();
    this._dialog.open = false;
  }

  protected render() {
    const title = this._localize("dashboard.logs_title", { name: this.name });
    const toggleLabel = this._localize(
      this._showStates ? "dashboard.logs_hide_states" : "dashboard.logs_show_states"
    );

    return html`
      <wa-dialog label=${title} light-dismiss @wa-after-hide=${this._onDialogHide}>
        <div class="logs-content">
          <esphome-ansi-log
            .lines=${this._lines}
            placeholder=${this._localize("dashboard.logs_placeholder")}
            ?light=${!this._darkMode}
          ></esphome-ansi-log>
          <div class="terminal-toolbar">
            ${this._backToInstall
              ? html`
                  <button
                    class="term-btn term-btn--ghost"
                    @click=${this._onBackToInstall}
                    title=${this._localize("dashboard.logs_back_to_install_tooltip")}
                  >
                    <wa-icon library="mdi" name="arrow-left"></wa-icon>
                    ${this._localize("dashboard.logs_back_to_install")}
                  </button>
                `
              : ""}
            ${this._streaming ? html`<span class="streaming-dot"></span>` : ""}
            <span class="spacer"></span>
            ${this._passive
              ? ""
              : html`
                  <button
                    class="term-btn term-btn--ghost ${this._showStates
                      ? "is-active"
                      : ""}"
                    @click=${this._toggleShowStates}
                    title=${toggleLabel}
                    aria-pressed=${this._showStates ? "true" : "false"}
                  >
                    <wa-icon library="mdi" name="pulse"></wa-icon>
                    ${this._localize("dashboard.logs_states")}
                  </button>
                `}
            <button
              class="term-btn term-btn--ghost expand-btn"
              @click=${this._toggleExpanded}
            >
              <wa-icon
                library="mdi"
                name=${this._expanded ? "arrow-collapse" : "arrow-expand"}
              ></wa-icon>
            </button>
            <button class="term-btn term-btn--ghost" @click=${this._downloadLogs}>
              <wa-icon library="mdi" name="download"></wa-icon>
            </button>
            <button
              class="term-btn term-btn--ghost"
              @click=${this._clearLogs}
              title=${this._localize("dashboard.logs_clear")}
            >
              <wa-icon library="mdi" name="delete-sweep"></wa-icon>
              ${this._localize("dashboard.logs_clear")}
            </button>
            ${this._streaming
              ? html`
                  <button class="term-btn term-btn--stop" @click=${this._stopStreaming}>
                    <wa-icon library="mdi" name="stop"></wa-icon>
                    ${this._localize("dashboard.logs_stop")}
                  </button>
                `
              : html`
                  <button class="term-btn term-btn--start" @click=${this._startStreaming}>
                    <wa-icon library="mdi" name="play"></wa-icon>
                    ${this._localize("dashboard.logs_start")}
                  </button>
                `}
          </div>
        </div>
      </wa-dialog>
    `;
  }

  private _startStreaming() {
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

  private _onDialogHide() {
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
    this._dialog.open = false;
    handler?.();
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-logs-dialog": ESPHomeLogsDialog;
  }
}
