import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { driveFakeTimers } from "../_fake-timers.js";
import { disconnectEvents } from "../_web-serial.js";
import { SerialByteSession } from "../../src/util/serial-byte-session.js";
import { SerialDeviceLostError } from "../../src/util/serial-open-error.js";

class Session extends SerialByteSession {}

function open(signal?: AbortSignal) {
  let out!: ReadableStreamDefaultController<Uint8Array>;
  const port = {
    ...disconnectEvents(),
    readable: new ReadableStream<Uint8Array>({ start: (c) => (out = c) }),
    writable: new WritableStream<Uint8Array>(),
  };
  const session = new Session(port as unknown as SerialPort, signal);
  return {
    session,
    arrive: (...bytes: number[]) => out.enqueue(new Uint8Array(bytes)),
    drop: () => out.close(),
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("SerialByteSession", () => {
  it("hands out the bytes in the order they came", async () => {
    const { session, arrive } = open();
    arrive(1, 2);
    arrive(3);

    expect(await driveFakeTimers(session.readByte(100))).toBe(1);
    expect([...(await driveFakeTimers(session.readBytes(2, 100)))]).toEqual([2, 3]);
  });

  it("waits on past a chunk that holds nothing", async () => {
    const { session, arrive } = open();
    const read = session.readByte(100);
    await vi.advanceTimersByTimeAsync(10);

    arrive();
    await vi.advanceTimersByTimeAsync(10);
    arrive(7);

    expect(await driveFakeTimers(read)).toBe(7);
  });

  it("gives nothing when no byte comes in time", async () => {
    const { session } = open();

    expect(await driveFakeTimers(session.readByte(100))).toBeNull();
  });

  it("waits for the bytes that are still to come, each for as long again", async () => {
    const { session, arrive } = open();
    const read = session.readBytes(3, 100);
    arrive(1);
    await vi.advanceTimersByTimeAsync(80);
    arrive(2);
    await vi.advanceTimersByTimeAsync(80);
    arrive(3);

    expect([...(await driveFakeTimers(read))]).toEqual([1, 2, 3]);
  });

  it("fails when the bytes do not all come", async () => {
    const { session, arrive } = open();
    arrive(1);

    const read = session.readBytes(3, 100);
    read.catch(() => {});

    await expect(driveFakeTimers(read)).rejects.toThrow(
      "Timed out waiting for 3 bytes (got 1)"
    );
  });

  it("forgets what came when it is drained", async () => {
    const { session, arrive } = open();
    arrive(1, 2);
    await vi.advanceTimersByTimeAsync(0);

    session.drain();

    expect(await driveFakeTimers(session.readByte(10))).toBeNull();
  });

  it("collects what comes until the line is quiet", async () => {
    const { session, arrive } = open();
    const read = session.readQuiet(50, 1000);
    arrive(1);
    await vi.advanceTimersByTimeAsync(30);
    arrive(2);

    expect([...(await driveFakeTimers(read))]).toEqual([1, 2]);
  });

  it("stops collecting when its window is over", async () => {
    const { session } = open();

    expect(await driveFakeTimers(session.readQuiet(50, 200))).toHaveLength(0);
    expect(await driveFakeTimers(session.readQuiet(50, 0))).toHaveLength(0);
  });

  it("hands out what came before the port went away, then fails", async () => {
    const { session, arrive, drop } = open();
    arrive(7);
    drop();
    await vi.advanceTimersByTimeAsync(0);

    // What is in the buffer is not lost with the port.
    await expect(driveFakeTimers(session.readByte(100))).resolves.toBe(7);
    const read = session.readByte(100);
    read.catch(() => {});
    await expect(driveFakeTimers(read)).rejects.toBeInstanceOf(SerialDeviceLostError);
  });

  it("fails a wait that the port goes away under", async () => {
    const { session, drop } = open();
    const read = session.readByte(1000);
    read.catch(() => {});

    drop();

    await expect(driveFakeTimers(read)).rejects.toBeInstanceOf(SerialDeviceLostError);
  });

  it("ends a wait on abort", async () => {
    const abort = new AbortController();
    const { session } = open(abort.signal);
    const read = session.readByte(1000);
    read.catch(() => {});

    abort.abort(new DOMException("stop", "AbortError"));

    await expect(driveFakeTimers(read)).rejects.toMatchObject({ name: "AbortError" });
  });

  it("does not start a wait once it was aborted", async () => {
    const abort = new AbortController();
    const { session } = open(abort.signal);
    abort.abort(new DOMException("stop", "AbortError"));

    const read = session.readByte(1000);
    read.catch(() => {});

    await expect(driveFakeTimers(read)).rejects.toMatchObject({ name: "AbortError" });
  });

  it("keeps no timer and no one to wake once a wait is over", async () => {
    const abort = new AbortController();
    const { session, arrive } = open(abort.signal);
    const state = session as unknown as { wake: unknown };

    // Its time ran out.
    await expect(driveFakeTimers(session.readByte(5))).resolves.toBeNull();
    expect(state.wake).toBeNull();
    expect(vi.getTimerCount()).toBe(0);

    // Bytes came.
    const read = session.readByte(1000);
    arrive(1);
    await expect(driveFakeTimers(read)).resolves.toBe(1);
    expect(state.wake).toBeNull();
    expect(vi.getTimerCount()).toBe(0);

    // The abort came.
    const aborted = session.readByte(1000);
    aborted.catch(() => {});
    abort.abort(new DOMException("stop", "AbortError"));
    await expect(aborted).rejects.toMatchObject({ name: "AbortError" });
    expect(state.wake).toBeNull();
    expect(vi.getTimerCount()).toBe(0);

    // It was aborted before it started.
    await expect(session.readByte(1000)).rejects.toMatchObject({ name: "AbortError" });
    expect(state.wake).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps nothing of a read that timed out, however many there were", async () => {
    const { session } = open(new AbortController().signal);
    const waits = session as unknown as { onAbort: Set<unknown> };

    const pending = session.readByte(5);
    expect(waits.onAbort.size).toBe(1);
    await expect(driveFakeTimers(pending)).resolves.toBeNull();
    for (let i = 0; i < 50; i++) {
      await expect(driveFakeTimers(session.readByte(5))).resolves.toBeNull();
    }

    expect(waits.onAbort.size).toBe(0);
  });
});
