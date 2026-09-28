/**
 * A session's write ends when the device goes away: written to a device that
 * was unplugged it can stay pending, and the engine would wait on it without
 * end (#1896).
 */
import { describe, expect, it, vi } from "vitest";

import { makeDisconnectPort } from "../_web-serial.js";
import { SerialDeviceLostError } from "../../src/util/serial-open-error.js";
import { SerialStreamSession } from "../../src/util/serial-stream-session.js";

class Session extends SerialStreamSession {
  ended: Error | null = null;

  protected onBytes(): void {}

  protected onEnded(err: Error): void {
    this.ended = err;
  }

  write(bytes: Uint8Array): Promise<void> {
    return this.writeBytes(bytes);
  }

  wait<T>(p: Promise<T>): Promise<T> {
    return this.race(p);
  }
}

/** A port whose write never returns, and whose read waits or fails on demand. */
function stuckPort() {
  let failRead: (err: Error) => void = () => {};
  const port = Object.assign(makeDisconnectPort(), {
    readable: new ReadableStream<Uint8Array>({
      start: (controller) => (failRead = (err) => controller.error(err)),
    }),
    writable: new WritableStream<Uint8Array>({ write: () => new Promise(() => {}) }),
  });
  return { port, failRead: (err: Error) => failRead(err) };
}

const lost = () => new DOMException("The device has been lost.", "NetworkError");

describe("SerialStreamSession", () => {
  it("fails a write that never returns when the port reports the device gone", async () => {
    const { port } = stuckPort();
    const session = new Session(port);
    const write = session.write(new Uint8Array([1]));
    port.fire();
    await expect(write).rejects.toBeInstanceOf(SerialDeviceLostError);
    expect(session.ended).toBeInstanceOf(SerialDeviceLostError);
  });

  it("fails a write that never returns when the read ends first", async () => {
    const { port, failRead } = stuckPort();
    const session = new Session(port);
    const write = session.write(new Uint8Array([1]));
    const gone = lost();
    failRead(gone);
    // One error for a lost device, however it was noticed.
    await expect(write).rejects.toBeInstanceOf(SerialDeviceLostError);
    await expect(write).rejects.toMatchObject({ cause: gone });
  });

  it("fails a later write at once, and keeps the first reason", async () => {
    const { port, failRead } = stuckPort();
    const session = new Session(port);
    const gone = lost();
    failRead(gone);
    await expect(session.write(new Uint8Array([1]))).rejects.toMatchObject({
      cause: gone,
    });
    const first = session.ended;
    port.fire();
    expect(session.ended).toBe(first);
  });

  it("ends the session when the browser fails the write first", async () => {
    const gone = lost();
    const port = Object.assign(makeDisconnectPort(), {
      readable: new ReadableStream<Uint8Array>(),
      writable: new WritableStream<Uint8Array>({ write: () => Promise.reject(gone) }),
    });
    const session = new Session(port);
    await expect(session.write(new Uint8Array([1]))).rejects.toMatchObject({
      name: "SerialDeviceLostError",
      cause: gone,
    });
    // Whatever waits on an answer is told too.
    expect(session.ended).toBeInstanceOf(SerialDeviceLostError);
  });

  it("takes a stream that ends under it for the device going away", async () => {
    let endRead = (): void => {};
    const port = Object.assign(makeDisconnectPort(), {
      readable: new ReadableStream<Uint8Array>({
        start: (controller) => (endRead = () => controller.close()),
      }),
      writable: new WritableStream<Uint8Array>({ write: () => new Promise(() => {}) }),
    });
    const session = new Session(port);
    const write = session.write(new Uint8Array([1]));
    endRead();
    await expect(write).rejects.toBeInstanceOf(SerialDeviceLostError);
  });

  it("keeps a read that ended for another reason as it is", async () => {
    const { port, failRead } = stuckPort();
    const session = new Session(port);
    const framing = new DOMException("Framing error", "FramingError");
    failRead(framing);
    await expect(session.write(new Uint8Array([1]))).rejects.toBe(framing);
  });

  it("fails a write at once on a session that has ended", async () => {
    const { port } = stuckPort();
    const session = new Session(port);
    port.fire();
    await Promise.resolve();
    expect(session.ended).toBeInstanceOf(SerialDeviceLostError);

    await expect(session.write(new Uint8Array([1]))).rejects.toBeInstanceOf(
      SerialDeviceLostError
    );
  });

  it("tells every write that is under way of the abort", async () => {
    const abort = new AbortController();
    const session = new Session(stuckPort().port, abort.signal);
    const first = session.write(new Uint8Array([1]));
    const second = session.write(new Uint8Array([2]));

    abort.abort(new DOMException("stop", "AbortError"));

    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    await expect(second).rejects.toMatchObject({ name: "AbortError" });
  });

  it("ends a wait with the abort when its result and the abort are both in already", async () => {
    const abort = new AbortController();
    const session = new Session(stuckPort().port, abort.signal);
    const waits = session as unknown as { onAbort: Set<unknown> };
    const stop = new DOMException("stop", "AbortError");

    // The result is in, and the abort comes before anything reads it.
    const late = session.wait(Promise.resolve(1));
    abort.abort(stop);
    await expect(late).rejects.toBe(stop);

    // Both are in before the wait starts.
    await expect(session.wait(Promise.resolve(2))).rejects.toBe(stop);
    expect(waits.onAbort.size).toBe(0);
  });

  it("has forgotten a wait by the time whoever waited on it goes on", async () => {
    const session = new Session(stuckPort().port, new AbortController().signal);
    const waits = session as unknown as { onAbort: Set<unknown> };

    await session.wait(Promise.resolve(1));
    expect(waits.onAbort.size).toBe(0);

    const failed = new Error("no");
    await expect(session.wait(Promise.reject(failed))).rejects.toBe(failed);
    expect(waits.onAbort.size).toBe(0);
  });

  it("hands out a result that is in when no abort came", async () => {
    const session = new Session(stuckPort().port, new AbortController().signal);

    await expect(session.wait(Promise.resolve(1))).resolves.toBe(1);
  });

  it("keeps nothing of a stuck write that the abort ended", async () => {
    const abort = new AbortController();
    const session = new Session(stuckPort().port, abort.signal);
    const waits = session as unknown as { onAbort: Set<unknown>; onGone: Set<unknown> };
    const write = session.write(new Uint8Array([1]));
    expect(waits.onGone.size).toBe(1);

    abort.abort(new DOMException("stop", "AbortError"));

    await expect(write).rejects.toMatchObject({ name: "AbortError" });
    // The write itself never returns, and is not waited for by anything.
    expect(waits.onAbort.size).toBe(0);
    expect(waits.onGone.size).toBe(0);
  });

  it("keeps nothing of a stuck write that the device going away ended", async () => {
    const { port } = stuckPort();
    const session = new Session(port, new AbortController().signal);
    const waits = session as unknown as { onAbort: Set<unknown>; onGone: Set<unknown> };
    const write = session.write(new Uint8Array([1]));
    expect(waits.onAbort.size).toBe(1);

    port.fire();

    await expect(write).rejects.toBeInstanceOf(SerialDeviceLostError);
    expect(waits.onAbort.size).toBe(0);
    expect(waits.onGone.size).toBe(0);
  });

  it("keeps nothing of a write that is over, however many there were", async () => {
    const port = Object.assign(makeDisconnectPort(), {
      readable: new ReadableStream<Uint8Array>(),
      writable: new WritableStream<Uint8Array>(),
    });
    const session = new Session(port, new AbortController().signal);
    const waits = session as unknown as { onAbort: Set<unknown>; onGone: Set<unknown> };

    const pending = session.write(new Uint8Array([1]));
    expect(waits.onAbort.size).toBe(1);
    expect(waits.onGone.size).toBe(1);
    await pending;
    for (let i = 0; i < 50; i++) await session.write(new Uint8Array([i]));

    expect(waits.onAbort.size).toBe(0);
    expect(waits.onGone.size).toBe(0);
  });

  it("does not listen to a signal that is aborted already, and ends every wait on it", async () => {
    const abort = new AbortController();
    const stop = new DOMException("stop", "AbortError");
    abort.abort(stop);
    const add = vi.spyOn(abort.signal, "addEventListener");

    const session = new Session(stuckPort().port, abort.signal);

    expect(add).not.toHaveBeenCalled();
    await expect(session.write(new Uint8Array([1]))).rejects.toBe(stop);
    await expect(session.wait(Promise.resolve(1))).rejects.toBe(stop);
  });

  it("ends the waits that are under way when it is closed", async () => {
    const session = new Session(stuckPort().port, new AbortController().signal);
    const waits = session as unknown as { onAbort: Set<unknown>; onGone: Set<unknown> };
    const never = session.wait(new Promise<void>(() => {}));
    const write = session.write(new Uint8Array([1]));
    never.catch(() => {});
    write.catch(() => {});

    const why = new Error("the flash failed");
    void session.close(why);

    await expect(never).rejects.toBe(why);
    await expect(write).rejects.toBe(why);
    expect(waits.onAbort.size).toBe(0);
    expect(waits.onGone.size).toBe(0);
  });

  it("ends a wait that is under way when it is closed with nothing wrong", async () => {
    const port = Object.assign(makeDisconnectPort(), {
      readable: new ReadableStream<Uint8Array>(),
      writable: new WritableStream<Uint8Array>(),
    });
    const session = new Session(port, new AbortController().signal);
    const never = session.wait(new Promise<void>(() => {}));
    never.catch(() => {});

    await session.close();

    await expect(never).rejects.toThrow("Serial session closed");
  });

  it("stops listening to the abort when it is closed", async () => {
    const abort = new AbortController();
    const remove = vi.spyOn(abort.signal, "removeEventListener");
    const port = Object.assign(makeDisconnectPort(), {
      readable: new ReadableStream<Uint8Array>(),
      writable: new WritableStream<Uint8Array>(),
    });
    const session = new Session(port, abort.signal);
    const waits = session as unknown as { onAbort: Set<unknown> };

    await session.close();

    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    // An abort that comes later finds no one to tell.
    const told = vi.fn();
    waits.onAbort.add(told);
    abort.abort();
    expect(told).not.toHaveBeenCalled();
  });

  it("stops listening to the port when it is closed", async () => {
    const { port } = stuckPort();
    const session = new Session(port);
    expect(port.listenerCount()).toBe(1);
    await session.close(new Error("done"));
    expect(port.listenerCount()).toBe(0);
  });
});
