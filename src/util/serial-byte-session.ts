/**
 * A serial session read as bytes: the read loop feeds a buffer that an
 * engine's command helpers consume with timeouts. Every wait is raced
 * against the abort signal and fails once the port is gone.
 *
 * For one reader at a time: the bytes are one stream, so two reads that
 * wait together have no order between them, and only the later is woken.
 */
import { SerialStreamSession } from "./serial-stream-session.js";

export abstract class SerialByteSession extends SerialStreamSession {
  protected buf: number[] = [];
  private wake: (() => void) | null = null;

  protected onBytes(bytes: Uint8Array): void {
    // An empty chunk is no arrival: woken for it, a read would find
    // nothing and take that for its time running out.
    if (bytes.length === 0) return;
    for (const b of bytes) this.buf.push(b);
    this.wake?.();
  }

  protected onEnded(): void {
    this.wake?.();
  }

  /** Resolves true when bytes arrived, false on timeout; throws once the port is gone. */
  protected waitForData(timeoutMs: number): Promise<boolean> {
    if (this.readEnded) return Promise.reject(this.readEnded);
    if (this.signal?.aborted) return Promise.reject(this.signal.reason);
    // However the wait ends (bytes, its time, the abort, the port), its
    // timer and its place as the one to wake go with it.
    let over = (): void => {};
    const arrived = new Promise<boolean>((resolve) => {
      const wake = (): void => resolve(true);
      const timer = setTimeout(() => resolve(false), timeoutMs);
      this.wake = wake;
      over = () => {
        clearTimeout(timer);
        if (this.wake === wake) this.wake = null;
      };
    });
    return this.race(arrived)
      .then((got) => {
        if (got && this.readEnded && this.buf.length === 0) throw this.readEnded;
        return got;
      })
      .finally(over);
  }

  drain(): void {
    this.buf = [];
  }

  async readByte(timeoutMs: number): Promise<number | null> {
    if (this.buf.length === 0 && !(await this.waitForData(timeoutMs))) return null;
    return this.buf.shift() ?? null;
  }

  /** Exactly ``count`` bytes; the timeout restarts with every arrival. */
  async readBytes(count: number, timeoutMs: number): Promise<Uint8Array> {
    while (this.buf.length < count) {
      if (!(await this.waitForData(timeoutMs))) {
        throw new Error(`Timed out waiting for ${count} bytes (got ${this.buf.length})`);
      }
    }
    return new Uint8Array(this.buf.splice(0, count));
  }

  /** Everything received until ``quietMs`` of silence, at most ``windowMs``. */
  async readQuiet(quietMs: number, windowMs: number): Promise<Uint8Array> {
    const deadline = Date.now() + windowMs;
    while (Date.now() < deadline) {
      const wait = Math.min(quietMs, deadline - Date.now());
      if (!(await this.waitForData(wait)) && this.buf.length > 0) break;
    }
    return new Uint8Array(this.buf.splice(0));
  }
}
