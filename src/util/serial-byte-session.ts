/**
 * A serial session read as bytes: the read loop feeds a buffer that an
 * engine's command helpers consume with timeouts. Every wait is raced
 * against the abort signal and fails once the port is gone.
 */
import { SerialStreamSession } from "./serial-stream-session.js";

export abstract class SerialByteSession extends SerialStreamSession {
  protected buf: number[] = [];
  private wake: (() => void) | null = null;

  protected onBytes(bytes: Uint8Array): void {
    for (const b of bytes) this.buf.push(b);
    this.wake?.();
  }

  protected onEnded(): void {
    this.wake?.();
  }

  /** Resolves true when bytes arrived, false on timeout; throws once the port is gone. */
  protected waitForData(timeoutMs: number): Promise<boolean> {
    if (this.readEnded) return Promise.reject(this.readEnded);
    let timer: ReturnType<typeof setTimeout>;
    const arrived = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
      this.wake = () => {
        clearTimeout(timer);
        this.wake = null;
        resolve(true);
      };
    });
    return this.race(arrived).then((got) => {
      if (got && this.readEnded && this.buf.length === 0) throw this.readEnded;
      return got;
    });
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
