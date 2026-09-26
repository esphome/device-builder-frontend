import { consume } from "@lit/context";
import { mdiDeleteSweep, mdiDownload, mdiPlay, mdiRestart, mdiStop } from "@mdi/js";
import { html, LitElement } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import toast from "sonner-js";

import type { LocalizeFunc } from "../../common/localize.js";
import {
  renderCrashCallout,
  repinTerminalForCallout,
} from "../../components/process-terminal/crash-callout.js";
import type { ESPHomeProcessTerminal } from "../../components/process-terminal/process-terminal.js";
import { localizeContext } from "../../context/index.js";
import {
  classifyLine,
  type CrashKind,
  latchCrashKind,
} from "../../util/crash-detector.js";
import { downloadAnsiText } from "../../util/download-text.js";
import { getErrorMessage } from "../../util/error-message.js";
import { normalizeLogLine } from "../../util/log-line.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import type { SerialLineHooks } from "../../util/serial-log-stream.js";
import { BleLogSource } from "./ble-source.js";
import { webLogsDialogStyles } from "./esphome-web-logs-dialog.styles.js";
import type { WebLogSource } from "./log-source.js";
import { RTS_PULSE, type WebSerialReset } from "./serial-reset.js";
import { SerialLogSource } from "./serial-source.js";
import { renderWebLogsToolbar } from "./toolbar.js";

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

// Consecutive reconnect cycles that produced no log lines before giving up:
// a flapping bridge or a device stuck resetting must not churn forever.
const MAX_SILENT_RECONNECTS = 3;

/**
 * Log viewer for ESPHome Web.
 *
 * Reuses the dashboard's ``process-terminal`` display but drives it from a
 * plain Web Serial reader, or a Bluetooth NUS subscription, instead of the
 * backend logs WS — no ``apiContext``, no OTA source. For serial the parent
 * opens the port (via ``openPortForLogs``) before showing the dialog; the
 * dialog streams it and closes it on ``after-hide``, and after a mid-stream
 * disconnect the source rides it out (the serial one closes the dead handle
 * and reopens a live one; the Bluetooth one reconnects a few times).
 */
@customElement("esphome-web-logs-dialog")
export class ESPHomeWebLogsDialog extends LitElement {
  /** Authorized (closed) serial port to stream from. */
  @property({ attribute: false }) port?: SerialPort;

  /** A picked NUS peripheral to stream from instead of a port. */
  @property({ attribute: false }) bleDevice?: BluetoothDevice;

  /** Reactive open flag, driven by the parent device card. */
  @property({ type: Boolean }) open = false;

  /** Human label used in the dialog title and the download filename. */
  @property() deviceLabel = "";

  /**
   * How Reset Device reaches the board, handed in by the family's card: the
   * RTS pulse by default, the Pico's own reboot, or none (an nRF52).
   */
  @property({ attribute: false }) reset?: WebSerialReset = RTS_PULSE;

  /** Drop DTR and RTS after every (re)open: the RTL8720C's strap and reset lines. */
  @property({ type: Boolean, attribute: "release-lines" }) releaseLines = false;

  @consume({ context: localizeContext, subscribe: true })
  @state()
  _localize: LocalizeFunc = (key) => key;

  @state() private _lines: string[] = [];
  // ``_streaming`` = reader alive and displaying (drives the pulsing dot + the
  // Stop button). ``_paused`` = user pressed Stop; the reader keeps draining the
  // port (so Start resumes without a reopen/reset) but appends are dropped.
  @state() _streaming = false;
  @state() _paused = false;
  // Latched once a crash marker flows through the stream; drives the callout
  // for the rest of the session. A live panic upgrades a previous-boot report;
  // nothing downgrades it (mirrors the builder's logs dialog).
  @state() private _crashKind: CrashKind | null = null;

  @query("esphome-process-terminal")
  private _terminal?: ESPHomeProcessTerminal;

  // Reactive so the toolbar can offer Reset Device only over a live stream.
  @state() private _cancel?: () => Promise<void>;
  // The transport of the current session; set for as long as the session
  // lives, streaming or mid-recovery.
  private _source?: WebLogSource;
  // Supersedes an attach or resume still in flight (close, a newer drop).
  private _generation = 0;
  // Consecutive reconnects that have produced no log lines yet; reset by
  // the first line after a resume, checked against MAX_SILENT_RECONNECTS.
  private _silentReconnects = 0;
  // Batched line buffer flushed on the next animation frame, matching the
  // dashboard logs dialog (logs-dialog.ts): a flooding device would otherwise
  // trigger a Lit render per line. Flushed early on teardown / clear / download.
  private _pendingLines: string[] = [];
  private _flushScheduled = 0;

  // One (open, source) → streaming reconcile: the device cards open with the
  // port already set, the flash receiver opens first and assigns the port
  // once the rebooted device re-enumerates. _start's guards make the extra
  // calls no-ops, including a port swapped mid-stream or mid-reconnect —
  // the dialog owns its active handle and announces swaps via port-replaced.
  protected updated(changed: Map<string, unknown>): void {
    if (!changed.has("open") && !changed.has("port") && !changed.has("bleDevice")) return;
    if (this.open) {
      this._start();
    } else if (changed.has("open")) {
      this._stop();
    }
  }

  // A genuine unplug collapses the whole device card (the connect card's
  // watcher), unmounting this dialog mid-reacquire — cancel it.
  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._stop();
  }

  /** Reset Device is a serial RTS pulse; never over Bluetooth. */
  get canReset(): boolean {
    return !this.bleDevice && (this.reset?.available() ?? false);
  }

  /**
   * A reset needs a live stream: during a reconnect or a reboot the port is
   * being reacquired, and a second reset would run another BOOTSEL sequence
   * against it.
   */
  get resetReady(): boolean {
    return this._cancel !== undefined;
  }

  private _start(): void {
    if (this._source) {
      this._refusePortSwap();
      return;
    }
    const source = this._makeSource();
    if (!source) return; // no (open) port or device yet — legitimately quiet
    this._source = source;
    this._resetLines();
    this._crashKind = null;
    this._paused = false;
    this._streaming = true;
    this._silentReconnects = 0;
    void this._attach(source);
  }

  // The parent opens the port (openPortForLogs) before showing the dialog, so
  // the initial serial stream reads it as-is. Defensive guard: a closed port
  // has no readable.
  private _makeSource(): WebLogSource | undefined {
    if (this.bleDevice) return new BleLogSource(this.bleDevice);
    if (!this.port?.readable) return undefined;
    return new SerialLogSource(this.port, {
      reset: this.canReset ? this.reset : undefined,
      releaseLinesAfterOpen: this.releaseLines,
      // A read-error-only disconnect fires no DOM disconnect event, so the
      // card's watcher may still hold the dead handle for its other actions.
      onPortReplaced: (port) =>
        this.dispatchEvent(
          new CustomEvent("port-replaced", {
            detail: port,
            bubbles: true,
            composed: true,
          })
        ),
    });
  }

  // Streaming or mid-recovery: a parent swapping .port in that window must
  // not wipe the rendered lines or race a second reader against the resume
  // (nor displace a Bluetooth session). The port-replaced round trip echoes
  // our own handle back — quiet. A genuinely foreign open handle (no known
  // producer) is closed too: the dialog declines custody, so nothing else
  // would ever release it.
  private _refusePortSwap(): void {
    const source = this._source;
    // A closed handle (a parent watcher's) holds nothing to release.
    if (!this.port?.readable) return;
    if (source instanceof SerialLogSource && this.port === source.activePort) return;
    console.warn("[Web Serial] Logs dialog refused a port swap mid-session");
    // A failure here is a genuinely leaked open port — log it loudly.
    void this.port.close().catch((err) => {
      console.error("[Web Serial] Failed to release the declined port:", err);
    });
  }

  // Same ESPHome log formatting / timestamps / garbage filtering as the
  // dashboard's serial and Bluetooth logs. Stop pauses only the display — the
  // reader keeps draining (so Start resumes without a reopen/reset) but
  // appends are dropped. The paused gate also covers crash detection: the
  // banner must never claim a crash the terminal (and a download) contains
  // no trace of.
  private _hooks(): SerialLineHooks {
    return {
      onLine: (line) => {
        this._silentReconnects = 0;
        if (this._paused) return;
        this._observeCrash(line);
        this._enqueueLine(line);
      },
      onDisconnect: (error) => this._onDisconnect(error),
    };
  }

  private async _attach(source: WebLogSource): Promise<void> {
    const generation = this._generation;
    let cancel: () => Promise<void>;
    try {
      cancel = await source.attach(this._hooks(), () => generation !== this._generation);
    } catch (err) {
      console.error("[Logs] connect failed:", err);
      // A dead session must not linger: release what the attach acquired
      // (a serial handle, say) so the next open starts clean.
      source.release();
      if (this._source === source) this._source = undefined;
      if (generation !== this._generation) return;
      this._streaming = false;
      this._enqueueLine(
        this._localize("web.logs.connect_failed", { error: getErrorMessage(err) })
      );
      this._flushPending();
      return;
    }
    if (generation !== this._generation) {
      this._releaseSuperseded(source, cancel);
      return;
    }
    this._cancel = cancel;
  }

  // Detection only — web.esphome.io has no backend to decode or report a
  // crash, so the callout stays a banner (the builder's dialog adds those).
  private _observeCrash(line: string): void {
    if (this._crashKind === "live") return; // latched; skip the regex scan
    const next = latchCrashKind(this._crashKind, classifyLine(normalizeLogLine(line)));
    if (next === this._crashKind) return;
    const firstDetection = this._crashKind === null;
    this._crashKind = next;
    if (firstDetection) {
      repinTerminalForCallout(this.updateComplete, () => this._terminal);
    }
  }

  // Stop → pause the display (reader stays alive). Start → resume. Start only
  // shows while ``_paused`` is true, which is only reachable with a live reader,
  // so resuming never lands on a dead stream.
  _onStop(): void {
    this._streaming = false;
    this._paused = true;
  }

  _onStart(): void {
    this._streaming = true;
    this._paused = false;
  }

  // The device dropped the stream on its own (unplugged / reset / out of
  // range). Print a "Terminal disconnected" line, then let the source ride
  // it out (a native-USB re-enumeration, a peripheral rebooting). Only a
  // device that stays gone ends the terminal for good.
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
    const source = this._source;
    if (!this.open || !source || ++this._silentReconnects > MAX_SILENT_RECONNECTS) {
      if (this.open && source) {
        // The cap case: every comeback succeeded but nothing readable ever
        // arrived — a different diagnosis than "did not come back".
        this._enqueueLine(this._localize("web.logs.reconnect_gave_up"));
      }
      // Nothing else will release what the dead stream left behind — an open
      // Web Serial port locks the device away from every other tool for the
      // tab's lifetime. The session is over: forget it, so a port handed in
      // next starts a fresh one instead of being refused as a swap.
      source?.release();
      if (source && this._source === source) this._source = undefined;
      this._flushPending();
      return;
    }
    this._enqueueLine(this._localize("web.logs.reconnecting"));
    this._flushPending();
    const generation = ++this._generation;
    void this._resume(source, generation, wasPaused).catch((err: unknown) => {
      // A failed comeback (a locked readable slipping through, a Bluetooth
      // reconnect that threw) must not strand the spinner on a dead stream.
      console.error("[Logs] reconnect failed:", err);
      if (generation !== this._generation) return;
      this._failReconnect(source, err);
    });
  }

  private async _resume(
    source: WebLogSource,
    generation: number,
    wasPaused: boolean
  ): Promise<void> {
    const cancel = await source.resume(
      this._hooks(),
      () => generation !== this._generation
    );
    if (generation !== this._generation) {
      this._releaseSuperseded(source, cancel ?? undefined);
      return;
    }
    if (!cancel) {
      this._failReconnect(source);
      return;
    }
    this._enqueueLine(this._localize("web.logs.reconnected"));
    this._enqueueLine("");
    // Honour a Stop pressed before the drop: the reader drains either way,
    // so the display stays paused instead of force-resuming.
    this._streaming = !wasPaused;
    this._paused = wasPaused;
    this._cancel = cancel;
  }

  // A stream that lost the generation race. Only a source no longer ours
  // (closed, replaced) still needs its stream released: with the source
  // unchanged, the bump came from its reader dying, and the recovery now
  // owns the handle (it closes and reopens it); cancelling the dead stream
  // then would close the reopened port under the recovery.
  private _releaseSuperseded(source: WebLogSource, cancel?: () => Promise<void>): void {
    if (this._source === source || !cancel) return;
    void cancel().catch((err) => {
      console.error("[Logs] Failed to release a superseded stream:", err);
    });
  }

  // Recovery failed ⇒ the handle is released and the spinner is down. A
  // Start button over a released handle would strand the spinner, and the
  // dead session is forgotten so a port handed in next starts a fresh one.
  private _failReconnect(source: WebLogSource, error?: unknown): void {
    this._streaming = false;
    this._paused = false;
    source.release();
    if (this._source === source) this._source = undefined;
    const base = this._localize("web.logs.reconnect_failed");
    this._enqueueLine(error === undefined ? base : `${base} (${getErrorMessage(error)})`);
    this._flushPending();
  }

  private _stop(): void {
    this._generation++;
    this._streaming = false;
    this._paused = false;
    this._resetPending();
    const cancel = this._cancel;
    this._cancel = undefined;
    const source = this._source;
    this._source = undefined;
    // A dead-stream path already dropped the cancel closure; release
    // whatever the recovery last held (a no-op when nothing is).
    if (cancel) {
      void cancel().catch((err) => {
        console.error("[Logs] Failed to release the stream:", err);
      });
    } else {
      source?.release();
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

  private _resetFailureKey(err: unknown): string {
    return this.reset?.failureKey?.(err) ?? "web.logs.reset_failed";
  }

  // Best-effort — some USB bridges don't wire the reset lines.
  async _resetDevice(): Promise<void> {
    const source = this._source;
    const reset = source?.reset;
    // No live session (the first attach failed): nothing to pulse.
    if (!source || !reset) {
      toast.error(this._localize("web.logs.reset_failed"));
      return;
    }
    if (!source.resetDropsStream) {
      try {
        await reset(() => false);
      } catch (err) {
        toast.error(this._localize(this._resetFailureKey(err)));
      }
      return;
    }
    // A reset that re-enumerates the port (a Pico rebooting through BOOTSEL):
    // end the stream, reboot, then come back the way a dropped stream does.
    // Not while a reconnect or an earlier reset is still reacquiring the port.
    const cancel = this._cancel;
    if (!cancel) return;
    const generation = ++this._generation;
    this._cancel = undefined;
    this._streaming = false;
    const wasPaused = this._paused;
    this._enqueueLine("");
    this._enqueueLine(this._localize("web.logs.rebooting"));
    this._flushPending();
    await cancel?.().catch((err) => {
      console.error("[Logs] Failed to release the stream before a reboot:", err);
    });
    try {
      await reset(() => generation !== this._generation);
    } catch (err) {
      console.warn("[Logs] reset failed:", err);
      toast.error(this._localize(this._resetFailureKey(err)));
      if (generation === this._generation) this._failReconnect(source);
      return;
    }
    if (generation !== this._generation) return;
    await this._resume(source, generation, wasPaused).catch((err: unknown) => {
      console.error("[Logs] reconnect failed:", err);
      if (generation === this._generation) this._failReconnect(source, err);
    });
  }

  _download(): void {
    this._flushPending();
    const stem = this.deviceLabel || "esphome-web";
    downloadAnsiText(this._lines, `${stem}-logs.txt`);
  }

  _clear(): void {
    this._resetLines();
    this._crashKind = null;
  }

  private _onAfterHide(): void {
    this._stop();
    this._lines = [];
    // A reopen that starts portless (the flash receiver's open-first shape)
    // renders before _start clears state — don't let last session's crash
    // banner sit over the fresh "Waiting…" terminal.
    this._crashKind = null;
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
          placeholder=${this._localize(
            this.bleDevice ? "web.logs.waiting_ble" : "web.logs.waiting"
          )}
        >
          ${renderCrashCallout(this._localize, this._crashKind)}
          ${renderWebLogsToolbar(this)}
        </esphome-process-terminal>
      </esphome-base-dialog>
    `;
  }

  static styles = webLogsDialogStyles;
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-web-logs-dialog": ESPHomeWebLogsDialog;
  }
}
