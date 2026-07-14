import { consume } from "@lit/context";
import { mdiDeleteSweep, mdiDownload, mdiPlay, mdiRestart, mdiStop } from "@mdi/js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import toast from "sonner-js";

import type { LocalizeFunc } from "../../common/localize.js";
import {
  fillTerminalOnMobile,
  termButtonStyles,
  termTokens,
} from "../../components/process-terminal/process-terminal.styles.js";
import { renderTermButton } from "../../components/process-terminal/toolbar-button.js";
import { localizeContext } from "../../context/index.js";
import { primaryDialogHeaderStyles } from "../../styles/dialog-header.js";
import { downloadAnsiText } from "../../util/download-text.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { streamSerialLines } from "../../util/serial-log-stream.js";
import { sleep } from "../../util/sleep.js";

import "../../components/base-dialog.js";
import "../../components/process-terminal/process-terminal.js";

registerMdiIcons({
  restart: mdiRestart,
  download: mdiDownload,
  "delete-sweep": mdiDeleteSweep,
  stop: mdiStop,
  play: mdiPlay,
});

// Hard cap on retained log lines, mirroring the dashboard logs dialog: a
// garbage-flooding device can emit faster than the view renders.
const MAX_LOG_LINES = 10000;

// ESPHome logs over UART default to 115200 baud. The dashboard resolves a
// per-device override from config; ESPHome Web has no device config, so the
// default is all that applies.
const LOG_BAUD_RATE = 115200;

/**
 * Open a port for the logs view before showing the dialog. Returns ``true`` if
 * the port is ready to stream. Opening here (in the caller's click gesture)
 * rather than inside the dialog keeps the failure path out of the dialog's
 * show/hide lifecycle. An already-open port (``InvalidStateError`` — a prior
 * action or reset race left it open) is fine; the dialog streams it as-is.
 */
export async function openPortForLogs(
  port: SerialPort,
  localize: LocalizeFunc
): Promise<boolean> {
  try {
    // 8k buffer (vs Chrome's 255-byte default) so a burst of boot logs in a
    // throttled/backgrounded tab doesn't overrun — matches the legacy site.
    await port.open({ baudRate: LOG_BAUD_RATE, bufferSize: 8192 });
  } catch (err) {
    // ``InvalidStateError`` means the port is already open. That's fine ONLY if
    // nothing else holds its reader — streamSerialLines() calls getReader(), so
    // a locked readable stream (another action mid-op) would fail. Bail loudly.
    if (err instanceof DOMException && err.name === "InvalidStateError") {
      if (port.readable?.locked) {
        toast.error(localize("web.logs.port_busy"));
        return false;
      }
      return true;
    }
    toast.error(
      localize("web.logs.open_failed", {
        error: err instanceof Error ? err.message : String(err),
      })
    );
    return false;
  }
  return true;
}

/**
 * Serial log viewer for ESPHome Web.
 *
 * Reuses the dashboard's ``process-terminal`` display but drives it from a
 * plain Web Serial reader instead of the backend logs WS — no ``apiContext``,
 * no OTA source. The parent opens the port (via ``openPortForLogs``) before
 * showing the dialog; the dialog streams it and closes it on ``after-hide``.
 */
@customElement("esphome-web-logs-dialog")
export class ESPHomeWebLogsDialog extends LitElement {
  /** Authorized (closed) serial port to stream from. */
  @property({ attribute: false }) port?: SerialPort;

  /** Reactive open flag, driven by the parent device card. */
  @property({ type: Boolean }) open = false;

  /** Human label used in the dialog title and the download filename. */
  @property() deviceLabel = "";

  /**
   * Hide the "Reset device" button. A DTR/RTS pulse doesn't reset an RP2040
   * native-USB CDC device, so the button is a no-op for the Pico — legacy hid
   * it for the same reason.
   */
  @property({ type: Boolean }) isPico = false;

  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @state() private _lines: string[] = [];
  // ``_streaming`` = reader alive and displaying (drives the pulsing dot + the
  // Stop button). ``_paused`` = user pressed Stop; the reader keeps draining the
  // port (so Start resumes without a reopen/reset) but appends are dropped.
  @state() private _streaming = false;
  @state() private _paused = false;

  private _cancel?: () => void;
  // Batched line buffer flushed on the next animation frame, matching the
  // dashboard logs dialog (logs-dialog.ts): a flooding device would otherwise
  // trigger a Lit render per line. Flushed early on teardown / clear / download.
  private _pendingLines: string[] = [];
  private _flushScheduled = 0;

  protected updated(changed: Map<string, unknown>): void {
    if (changed.has("open")) {
      if (this.open) {
        this._start();
      } else {
        this._stop();
      }
    }
  }

  // The parent opens the port (openPortForLogs) before showing the dialog, so
  // here we just stream it. Defensive guard: a closed port has no readable.
  private _start(): void {
    if (!this.port?.readable || this._cancel) return;
    this._resetLines();
    this._paused = false;
    this._streaming = true;
    // Shared reader: same ESPHome log formatting / timestamps / garbage
    // filtering as the dashboard's post-install serial logs. The cancel it
    // returns also closes the port.
    this._cancel = streamSerialLines(this.port, {
      // Stop pauses only the display — the reader keeps draining the port so a
      // Start resumes without a reopen (which would DTR/RTS-reset the device).
      onLine: (line) => {
        if (!this._paused) this._enqueueLine(line);
      },
      onDisconnect: (error) => this._onDisconnect(error),
    });
  }

  // Stop → pause the display (reader stays alive). Start → resume. Start only
  // shows while ``_paused`` is true, which is only reachable with a live reader,
  // so resuming never lands on a dead stream.
  private _onStop(): void {
    this._streaming = false;
    this._paused = true;
  }

  private _onStart(): void {
    this._streaming = true;
    this._paused = false;
  }

  // The device dropped the stream on its own (unplugged / reset). Print a
  // "Terminal disconnected" line and drop the spinner, matching legacy — the
  // terminal would otherwise look stuck streaming forever.
  private _onDisconnect(error?: unknown): void {
    this._enqueueLine("");
    this._enqueueLine("");
    const base = this._localize("web.logs.terminal_disconnected");
    this._enqueueLine(error ? `${base}: ${String(error)}` : base);
    this._flushPending();
    // Reader ended: no Stop/Start button (neither streaming nor paused).
    this._streaming = false;
    this._paused = false;
  }

  private _stop(): void {
    this._streaming = false;
    this._paused = false;
    this._resetPending();
    const cancel = this._cancel;
    this._cancel = undefined;
    cancel?.();
  }

  // Buffer a streamed line; flush on the next animation frame so a log flood
  // triggers one render per frame, not per line.
  private _enqueueLine(line: string): void {
    this._pendingLines.push(line);
    // rAF doesn't fire while the tab is hidden, so bound the pending buffer too.
    if (this._pendingLines.length > 2 * MAX_LOG_LINES) {
      this._pendingLines = this._pendingLines.slice(-MAX_LOG_LINES);
    }
    if (this._flushScheduled) return;
    this._flushScheduled = requestAnimationFrame(() => {
      this._flushScheduled = 0;
      this._flushPending();
    });
  }

  private _flushPending(): void {
    if (this._pendingLines.length === 0) return;
    const merged = [...this._lines, ...this._pendingLines];
    this._lines = merged.length > MAX_LOG_LINES ? merged.slice(-MAX_LOG_LINES) : merged;
    this._pendingLines = [];
  }

  private _resetPending(): void {
    this._pendingLines = [];
    if (this._flushScheduled) {
      cancelAnimationFrame(this._flushScheduled);
      this._flushScheduled = 0;
    }
  }

  private _resetLines(): void {
    this._resetPending();
    this._lines = [];
  }

  // Pulse RTS to reboot the running app so the user can capture boot logs,
  // matching legacy ewt-console.reset(): RTS high then low back-to-back, then a
  // 1s settle for the device to come back up. Best-effort — some USB bridges
  // don't wire the reset lines.
  private async _resetDevice(): Promise<void> {
    if (!this.port) return;
    try {
      await this.port.setSignals({ dataTerminalReady: false, requestToSend: true });
      await this.port.setSignals({ dataTerminalReady: false, requestToSend: false });
      await sleep(1000);
    } catch {
      toast.error(this._localize("web.logs.reset_failed"));
    }
  }

  private _download(): void {
    this._flushPending();
    const stem = this.deviceLabel || "esphome-web";
    downloadAnsiText(this._lines, `${stem}-logs.txt`);
  }

  private _clear(): void {
    this._resetLines();
  }

  private _onAfterHide(): void {
    this._stop();
    this._lines = [];
    this.dispatchEvent(new CustomEvent("after-hide", { bubbles: true }));
  }

  protected render() {
    const label = this.deviceLabel
      ? this._localize("web.logs.title_named", { name: this.deviceLabel })
      : this._localize("dashboard.logs");
    return html`
      <esphome-base-dialog
        .label=${label}
        ?open=${this.open}
        @after-hide=${this._onAfterHide}
      >
        <esphome-process-terminal
          variant="stream"
          .lines=${this._lines}
          .streaming=${this._streaming}
          placeholder=${this._localize("web.logs.waiting")}
        >
          <div class="toolbar-slot" slot="toolbar-right">
            ${
              this.isPico
                ? nothing
                : renderTermButton({
                    icon: "restart",
                    // Reuse the builder's logs-terminal labels (same context) so
                    // translators don't re-translate these generic strings.
                    label: this._localize("dashboard.logs_reset_device"),
                    onClick: () => void this._resetDevice(),
                  })
            }
            ${renderTermButton({
              icon: "download",
              title: this._localize("web.logs.download"),
              onClick: () => this._download(),
            })}
            ${renderTermButton({
              icon: "delete-sweep",
              label: this._localize("dashboard.logs_clear"),
              onClick: () => this._clear(),
            })}
            ${
              this._streaming
                ? renderTermButton({
                    icon: "stop",
                    label: this._localize("dashboard.logs_stop"),
                    variant: "stop",
                    onClick: () => this._onStop(),
                  })
                : this._paused
                  ? renderTermButton({
                      icon: "play",
                      label: this._localize("dashboard.logs_start"),
                      variant: "start",
                      onClick: () => this._onStart(),
                    })
                  : nothing
            }
          </div>
        </esphome-process-terminal>
      </esphome-base-dialog>
    `;
  }

  static styles = [
    // Brand-primary header bar, matching the builder's own logs dialog.
    primaryDialogHeaderStyles,
    termTokens,
    termButtonStyles,
    fillTerminalOnMobile,
    css`
      esphome-base-dialog {
        /* Wide enough for ESPHome's timestamp + [C][module:NNN] prefix plus a
           long message before wrapping (mirrors the builder's logs dialog). */
        --width: min(1300px, 94vw);
      }
      /* Dress the dialog body as the terminal surface: drop the default body
         padding so the terminal fills it edge-to-edge, and paint the body the
         terminal background so there's no seam behind the rounded corners. */
      esphome-base-dialog::part(body) {
        padding: 0;
        background: var(--term-bg);
        overflow: hidden;
      }
      esphome-process-terminal {
        display: block;
        /* Size the terminal's own flex column via its height variable, not the
           host's height: the internal .content defaults to 60vh, so forcing a
           taller host would leave a gap below the toolbar. */
        --process-terminal-height: min(70vh, 40rem);
        --process-terminal-max-height: min(70vh, 40rem);
      }
      .toolbar-slot {
        display: flex;
        gap: var(--wa-space-2xs);
        align-items: center;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-web-logs-dialog": ESPHomeWebLogsDialog;
  }
}
