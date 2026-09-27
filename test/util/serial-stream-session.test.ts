/**
 * A session's write ends when the device goes away: written to a device that
 * was unplugged it can stay pending, and the engine would wait on it without
 * end (#1896).
 */
import { describe, expect, it } from "vitest";

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

  it("stops listening to the port when it is closed", async () => {
    const { port } = stuckPort();
    const session = new Session(port);
    expect(port.listenerCount()).toBe(1);
    await session.close(new Error("done"));
    expect(port.listenerCount()).toBe(0);
  });
});
