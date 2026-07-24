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
import { openLiveSerialPort } from "../../util/web-serial.js";

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

// 8k buffer (vs Chrome's 255-byte default) so a burst of boot logs in a
// throttled/backgrounded tab doesn't overrun — matches the legacy site.
const LOG_BUFFER_SIZE = 8192;

// Consecutive reconnect cycles that produced no log lines before giving up:
// a flapping bridge or a device stuck resetting must not churn forever.
const MAX_SILENT_RECONNECTS = 3;

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
    await port.open({ baudRate: LOG_BAUD_RATE, bufferSize: LOG_BUFFER_SIZE });
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
 * After a mid-stream disconnect the dialog owns recovery: it closes the
 * dead handle and reopens a live one itself (``openLiveSerialPort``).
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
  // Handle currently streamed. Starts as ``port`` and is replaced when a
  // native-USB re-enumeration hands back a fresh handle; the parent's own
  // ``PortDisconnectWatcher`` swap can't be relied on here — Firefox keeps
  // the same handle, so no property change ever reaches this dialog.
  private _activePort?: SerialPort;
  // Supersedes stale reacquire attempts (close, a newer disconnect).
  private _reacquireGeneration = 0;
  // Consecutive reconnects that have produced no log lines yet; reset by
  // the first line after a resume, checked against MAX_SILENT_RECONNECTS.
  private _silentReconnects = 0;
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

  // A genuine unplug collapses the whole device card (the connect card's
  // watcher), unmounting this dialog mid-reacquire — cancel it.
  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._stop();
  }

  // The parent opens the port (openPortForLogs) before showing the dialog, so
  // the initial stream reads it as-is; reconnect reopens are this dialog's
  // own (_onDisconnect). Defensive guard: a closed port has no readable.
  private _start(): void {
    if (!this.port?.readable || this._cancel) return;
    this._resetLines();
    this._paused = false;
    this._streaming = true;
    this._silentReconnects = 0;
    this._streamFrom(this.port);
  }

  // Shared reader: same ESPHome log formatting / timestamps / garbage
  // filtering as the dashboard's post-install serial logs. The cancel it
  // returns also closes the port. Single place the live handle is recorded,
  // so "streaming ⇒ _activePort set" holds by construction.
  private _streamFrom(port: SerialPort): void {
    this._activePort = port;
    this._cancel = streamSerialLines(port, {
      // Stop pauses only the display — the reader keeps draining the port so a
      // Start resumes without a reopen (which would DTR/RTS-reset the device).
      onLine: (line) => {
        this._silentReconnects = 0;
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
  // "Terminal disconnected" line, then ride out a native-USB re-enumeration
  // the way the connect cards do: reacquire the handle, reopen, and resume
  // streaming. Only a device that stays gone ends the terminal for good.
  private _onDisconnect(error?: unknown): void {
    this._enqueueLine("");
    this._enqueueLine("");
    const base = this._localize("web.logs.terminal_disconnected");
    this._enqueueLine(error ? `${base}: ${String(error)}` : base);
    // Reader ended: no Stop/Start button until the resume decides.
    this._cancel = undefined;
    this._streaming = false;
    const wasPaused = this._paused;
    this._paused = false;
    const port = this._activePort;
    if (!this.open || !port || ++this._silentReconnects > MAX_SILENT_RECONNECTS) {
      if (this.open && port) {
        this._enqueueLine(this._localize("web.logs.reconnect_failed"));
      }
      // The reader is gone and _cancel is cleared, so nothing else will
      // release the handle — an open Web Serial port locks the device
      // away from every other tool for the tab's lifetime.
      this._releaseActivePort();
      this._flushPending();
      return;
    }
    this._enqueueLine(this._localize("web.logs.reconnecting"));
    this._flushPending();
    const generation = ++this._reacquireGeneration;
    void this._resumeAfterDisconnect(port, generation, wasPaused).catch((err) => {
      // A throw in the resume tail (a locked readable slipping through)
      // must not strand the spinner on a dead stream.
      console.error("[Web Serial] Logs reconnect failed:", err);
      if (generation !== this._reacquireGeneration) return;
      this._failReconnect();
    });
  }

  private async _resumeAfterDisconnect(
    port: SerialPort,
    generation: number,
    wasPaused: boolean
  ): Promise<void> {
    // Close the dead stream's port first: the reacquired handle is often
    // this very one (a UART bridge, or Firefox after a re-enum), and
    // reopening a still-open port would re-read the dead stream and loop.
    // The dead reader already released its lock, so close() can proceed;
    // a UA that closed it on device loss rejects harmlessly. A real
    // failure is logged — it means the cached handle may come back dead.
    await port.close().catch((err) => {
      console.error("[Web Serial] Failed to close the dead logs port:", err);
    });
    const live = await openLiveSerialPort(port, {
      baudRate: LOG_BAUD_RATE,
      bufferSize: LOG_BUFFER_SIZE,
      cancelled: () => generation !== this._reacquireGeneration,
    });
    if (generation !== this._reacquireGeneration) {
      // Superseded after the open — reclaim the handle we just opened.
      // Logged loudly: a failure here is a genuinely leaked open port.
      if (live) {
        void live.close().catch((err) => {
          console.error("[Web Serial] Failed to release superseded port:", err);
        });
      }
      return;
    }
    if (!live) {
      this._failReconnect();
      return;
    }
    this._enqueueLine(this._localize("web.logs.reconnected"));
    this._enqueueLine("");
    // Honour a Stop pressed before the reset: the reader drains either
    // way, so the display stays paused instead of force-resuming.
    this._streaming = !wasPaused;
    this._paused = wasPaused;
    this._streamFrom(live);
    // Hand the recovered handle to the parent card: a read-error-only
    // disconnect fires no DOM disconnect event, so the card's watcher
    // may still hold the dead one for the other actions.
    this.dispatchEvent(
      new CustomEvent("port-replaced", {
        detail: live,
        bubbles: true,
        composed: true,
      })
    );
  }

  // Recovery failed ⇒ the handle is released and the spinner is down.
  private _failReconnect(): void {
    this._streaming = false;
    this._activePort = undefined;
    this._enqueueLine(this._localize("web.logs.reconnect_failed"));
    this._flushPending();
  }

  // Null-and-close the abandoned active handle in one step: the paired
  // invariant on every reader-already-dead path.
  private _releaseActivePort(): void {
    const active = this._activePort;
    this._activePort = undefined;
    void active?.close().catch(() => {});
  }

  private _stop(): void {
    this._reacquireGeneration++;
    this._streaming = false;
    this._paused = false;
    this._resetPending();
    const cancel = this._cancel;
    this._cancel = undefined;
    if (cancel) {
      this._activePort = undefined;
      cancel();
    } else {
      // A dead-stream path already dropped the cancel closure; release
      // whatever handle the reconnect flow last held (a no-op when the
      // UA closed it with the device).
      this._releaseActivePort();
    }
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
    // The reacquired handle after a re-enumeration, never the stale one.
    const port = this._activePort ?? this.port;
    if (!port) return;
    try {
      await port.setSignals({ dataTerminalReady: false, requestToSend: true });
      await port.setSignals({ dataTerminalReady: false, requestToSend: false });
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
