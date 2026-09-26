import { rebootPico } from "../../platforms/rp2/index.js";
import { releaseControlLines } from "../../util/serial-control-lines.js";
/**
 * Web Serial as a log source. The parent opened the port (``openPortForLogs``)
 * before the dialog showed; a drop mid-stream is ridden out the way the
 * connect cards do: close the dead handle, reacquire a live one, resume.
 */
import { type SerialLineHooks, streamSerialLines } from "../../util/serial-log-stream.js";
import { openLiveSerialPort } from "../../util/serial-reacquire.js";
import { sleep } from "../../util/sleep.js";
import type { WebLogSource } from "./log-source.js";

// ESPHome logs over UART default to 115200 baud. The dashboard resolves a
// per-device override from config; ESPHome Web has no device config, so the
// default is all that applies.
export const LOG_BAUD_RATE = 115200;

// 8k buffer (vs Chrome's 255-byte default) so a burst of boot logs in a
// throttled/backgrounded tab doesn't overrun: matches the legacy site.
export const LOG_BUFFER_SIZE = 8192;

/**
 * How Reset Device reaches the board: an RTS pulse on a UART bridge, the
 * BOOTSEL touch plus PICOBOOT reboot of a Pico (see rp2-logs-reset.ts; its
 * CDC port re-enumerates, so the stream is dropped and resumed), or nothing
 * for a native-USB CDC with no reset line (an nRF52).
 */
export type SerialResetMode = "rts" | "pico" | "none";

export interface SerialLogSourceOptions {
  reset: SerialResetMode;
  /** Drop DTR and RTS right after a reopen (the RTL8720C's strap lines). */
  releaseLinesAfterOpen?: boolean;
  /** A reacquired handle after a re-enumeration; the parent card adopts it. */
  onPortReplaced?: (port: SerialPort) => void;
}

export class SerialLogSource implements WebLogSource {
  // Handle currently streamed. Starts as the given port and is replaced when
  // a native-USB re-enumeration hands back a fresh handle; Firefox keeps the
  // same handle, so the parent's own watcher cannot be relied on for that.
  activePort?: SerialPort;

  constructor(
    private readonly port: SerialPort,
    private readonly options: SerialLogSourceOptions
  ) {
    if (options.reset === "rts") {
      this.reset = () => this.pulseReset();
    } else if (options.reset === "pico") {
      this.reset = (cancelled) => this.rebootThroughBootsel(cancelled);
      this.resetDropsStream = true;
    }
  }

  reset?: (cancelled: () => boolean) => Promise<void>;
  readonly resetDropsStream: boolean = false;

  // Shared reader: same ESPHome log formatting / timestamps / garbage
  // filtering as the dashboard's post-install serial logs. The cancel it
  // returns also closes the port.
  async attach(hooks: SerialLineHooks): Promise<() => Promise<void>> {
    return this.stream(this.port, hooks);
  }

  async resume(
    hooks: SerialLineHooks,
    cancelled: () => boolean
  ): Promise<(() => Promise<void>) | null> {
    const dead = this.activePort ?? this.port;
    // Close the dead stream's port first: the reacquired handle is often
    // this very one (a UART bridge, or Firefox after a re-enum), and
    // reopening a still-open port would re-read the dead stream and loop.
    // The dead reader already released its lock, so close() can proceed;
    // a UA that closed it on device loss rejects harmlessly. A real
    // failure is logged: it means the cached handle may come back dead.
    await dead.close().catch((err) => {
      // Already closed (the stream's cancel closes the port before a reboot).
      if (err instanceof DOMException && err.name === "InvalidStateError") return;
      console.error("[Web Serial] Failed to close the dead logs port:", err);
    });
    const live = await openLiveSerialPort(dead, {
      baudRate: LOG_BAUD_RATE,
      bufferSize: LOG_BUFFER_SIZE,
      cancelled,
    });
    if (cancelled()) {
      // Superseded after the open: reclaim the handle we just opened.
      // Logged loudly: a failure here is a genuinely leaked open port.
      void live?.close().catch((err) => {
        console.error("[Web Serial] Failed to release superseded port:", err);
      });
      return null;
    }
    if (!live) return null;
    if (this.options.releaseLinesAfterOpen) await releaseControlLines(live);
    const cancel = this.stream(live, hooks);
    this.options.onPortReplaced?.(live);
    return cancel;
  }

  // Null-and-close the abandoned active handle in one step: the paired
  // invariant on every reader-already-dead path.
  release(): void {
    const active = this.activePort;
    this.activePort = undefined;
    // A UA that closed the handle on device loss rejects harmlessly; a
    // live handle (a failed first attach) that will not close is a leak.
    void active?.close().catch((err) => {
      console.warn("[Web Serial] Failed to release the logs port:", err);
    });
  }

  private stream(port: SerialPort, hooks: SerialLineHooks): () => Promise<void> {
    this.activePort = port;
    return streamSerialLines(port, hooks);
  }

  // The stream's cancel closed the port already, which the routine expects;
  // the dialog resumes afterwards, which reacquires the re-enumerated port.
  private async rebootThroughBootsel(cancelled: () => boolean): Promise<void> {
    await rebootPico(this.activePort ?? this.port, cancelled);
  }

  // Pulse RTS to reboot the running app so the user can capture boot logs,
  // matching legacy ewt-console.reset(): RTS high then low back-to-back, then a
  // 1s settle for the device to come back up. Best-effort: some USB bridges
  // don't wire the reset lines.
  private async pulseReset(): Promise<void> {
    const port = this.activePort ?? this.port;
    await port.setSignals({ dataTerminalReady: false, requestToSend: true });
    await port.setSignals({ dataTerminalReady: false, requestToSend: false });
    await sleep(1000);
  }
}
