/**
 * The transport half of a Web Serial protocol session: the reader and writer
 * locks, a background read loop feeding ``onBytes``, an abort promise raced
 * against every wait (an in-flight stream read or write cannot be
 * interrupted, so the abort has to win the race instead), and a bounded
 * teardown. Engines extend it with their framing.
 *
 * A write is also raced against the device going away: written to a device
 * that was unplugged it can stay pending, and the engine would wait on it
 * without end (#1896).
 */
import { sleep } from "./sleep.js";

// Upper bound on stream teardown so a dead device can't hold the port open.
const STREAM_TEARDOWN_TIMEOUT_MS = 2000;

export abstract class SerialStreamSession {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private readonly writer: WritableStreamDefaultWriter<Uint8Array>;
  // Rejects on abort, never settles otherwise.
  private readonly aborted: Promise<never>;
  // Rejects with ``readEnded`` once the device is gone, never settles otherwise.
  private readonly gone: Promise<never>;
  private markGone: (err: Error) => void = () => {};
  private active = true;
  /** Why the read loop stopped (device gone, port error); set before ``onEnded``. */
  protected readEnded: Error | null = null;

  constructor(
    private readonly port: SerialPort,
    protected readonly signal?: AbortSignal
  ) {
    if (!port.readable || !port.writable) {
      throw new Error("Serial port has no readable / writable stream");
    }
    this.reader = port.readable.getReader();
    this.writer = port.writable.getWriter();
    this.aborted = new Promise<never>((_, reject) => {
      if (!signal) return;
      if (signal.aborted) reject(signal.reason);
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
    this.aborted.catch(() => {});
    this.gone = new Promise<never>((_, reject) => (this.markGone = reject));
    this.gone.catch(() => {});
    // The read loop ends by itself when the device goes; the event is for a
    // read that stays pending too. Worded as the read's own error is.
    port.addEventListener("disconnect", this.onDisconnect);
    void this.readLoop();
  }

  private onDisconnect = (): void => {
    this.end(new DOMException("The device has been lost.", "NetworkError"));
  };

  /** Bytes as they arrive; runs on the read loop. */
  protected abstract onBytes(bytes: Uint8Array): void;

  /** The read loop ended (``readEnded`` says why); fail whatever waits on it. */
  protected onEnded(_err: Error): void {}

  protected race<T>(p: Promise<T>): Promise<T> {
    p.catch(() => {}); // Losing the race must not surface as unhandled.
    return Promise.race([p, this.aborted]);
  }

  protected async writeBytes(bytes: Uint8Array): Promise<void> {
    await this.race(Promise.race([this.writer.write(bytes), this.gone]));
  }

  private async readLoop(): Promise<void> {
    while (this.active) {
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await this.reader.read();
      } catch (err) {
        this.end(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      if (result.done || !result.value) {
        this.end(new Error("Serial port closed"));
        return;
      }
      this.onBytes(result.value);
    }
  }

  private end(err: Error): void {
    // The first reason stands: a read that fails after the event adds nothing.
    if (this.readEnded) return;
    this.readEnded = err;
    this.markGone(err);
    this.onEnded(err);
  }

  /**
   * ``failure`` is the error that ended the session, if any. Then the writable
   * is errored with it (which also rejects the in-flight write) rather than
   * closed: port.close() aborts a still-writable stream with its own "The
   * port is closed." reason and drops that promise, which surfaces as an
   * unhandled rejection. A clean finish has no write in flight, so close().
   */
  async close(failure?: unknown): Promise<void> {
    this.active = false;
    this.port.removeEventListener("disconnect", this.onDisconnect);
    const writer =
      failure !== undefined ? this.writer.abort(failure) : this.writer.close();
    // Best effort: a dead port rejects these or never settles them.
    const settled = Promise.allSettled([this.reader.cancel(), writer]);
    await Promise.race([settled, sleep(STREAM_TEARDOWN_TIMEOUT_MS)]);
    this.reader.releaseLock();
    this.writer.releaseLock();
  }
}
