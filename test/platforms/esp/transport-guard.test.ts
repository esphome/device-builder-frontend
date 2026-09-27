/**
 * esptool-js bounds its reads, not its writes: a write to a board that was
 * unplugged stayed pending and the flash with it (#1896). The guard ends a
 * write or a read when the device goes, and a write it does not take in time.
 */
import type { Transport } from "esptool-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeDisconnectPort } from "../../_web-serial.js";
import {
  guardTransport,
  releaseTransportGuard,
  WRITE_DEADLINE_MS,
} from "../../../src/platforms/esp/transport-guard.js";
import {
  markOpenFailure,
  SerialDeviceLostError,
  SerialWriteStalledError,
} from "../../../src/util/serial-open-error.js";

const never = <T>() => new Promise<T>(() => {});
const DATA = new Uint8Array([1, 2]);

function fakeTransport(
  io: { write?: () => Promise<void>; read?: () => Promise<Uint8Array> } = {}
) {
  const device = makeDisconnectPort();
  const write = vi.fn(io.write ?? never<void>);
  const read = vi.fn(io.read ?? never<Uint8Array>);
  const transport = { device, write, read } as unknown as Transport;
  guardTransport(transport);
  return { transport, device, write, read };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("guardTransport", () => {
  it("fails a write that never returns when the board is unplugged", async () => {
    const { transport, device } = fakeTransport();
    const sent = transport.write(DATA);
    device.fire();
    await expect(sent).rejects.toBeInstanceOf(SerialDeviceLostError);
  });

  it("fails the wait for an answer when the board is unplugged", async () => {
    const { transport, device } = fakeTransport();
    // As while the chip writes a block, or erases: nothing is sent meanwhile.
    const answer = transport.read(40_000);
    device.fire();
    await expect(answer).rejects.toBeInstanceOf(SerialDeviceLostError);
  });

  it("fails at once for a board unplugged before, without touching the port", async () => {
    const { transport, device, write, read } = fakeTransport({ write: async () => {} });
    // As during the compile, with the session open and nothing being sent.
    device.fire();
    await expect(transport.write(DATA)).rejects.toBeInstanceOf(SerialDeviceLostError);
    await expect(transport.read(3000)).rejects.toBeInstanceOf(SerialDeviceLostError);
    expect(write).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it("names a stream the browser failed before it reported the device gone", async () => {
    const lost = () => new DOMException("The device has been lost.", "NetworkError");
    const { transport } = fakeTransport({
      write: () => Promise.reject(lost()),
      read: () => Promise.reject(lost()),
    });
    await expect(transport.write(DATA)).rejects.toBeInstanceOf(SerialDeviceLostError);
    await expect(transport.read(3000)).rejects.toBeInstanceOf(SerialDeviceLostError);
  });

  it("ends every later call once the browser failed the stream, without sending", async () => {
    const lost = new DOMException("The device has been lost.", "NetworkError");
    const { transport, write } = fakeTransport({ write: () => Promise.reject(lost) });
    const first = await transport.write(DATA).catch((err: unknown) => err);
    expect(first).toMatchObject({ cause: lost });
    // esptool-js sends the block again; the port is not asked a second time.
    await expect(transport.write(DATA)).rejects.toBe(first);
    await expect(transport.read(3000)).rejects.toBe(first);
    expect(write).toHaveBeenCalledOnce();
  });

  it("leaves a failed open, which the browser words the same, as it is", async () => {
    const busy = new DOMException("Failed to open serial port.", "NetworkError");
    markOpenFailure(busy);
    const { transport } = fakeTransport({ write: () => Promise.reject(busy) });
    await expect(transport.write(DATA)).rejects.toBe(busy);
  });

  it("fails a write the device does not take by the deadline, and every call after", async () => {
    const { transport, write } = fakeTransport();
    let failed: unknown;
    transport.write(DATA).catch((err: unknown) => (failed = err));
    await vi.advanceTimersByTimeAsync(WRITE_DEADLINE_MS - 1);
    expect(failed).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(failed).toBeInstanceOf(SerialWriteStalledError);
    expect(failed).toMatchObject({ seconds: 60 });

    // esptool-js sends the block again and reports the last failure: that
    // has to be the stall, not the stream the hung write still locks.
    await expect(transport.write(DATA)).rejects.toBe(failed);
    await expect(transport.read(3000)).rejects.toBe(failed);
    expect(write).toHaveBeenCalledOnce();
  });

  it("gives a read no deadline of its own", async () => {
    const { transport } = fakeTransport();
    let failed = false;
    transport.read(120_000).catch(() => (failed = true));
    await vi.advanceTimersByTimeAsync(WRITE_DEADLINE_MS * 5);
    expect(failed).toBe(false);
  });

  it("hands on what the port gives, and its own failure", async () => {
    const answer = new Uint8Array([9]);
    const fine = fakeTransport({ write: async () => {}, read: async () => answer });
    await expect(fine.transport.write(DATA)).resolves.toBeUndefined();
    expect(fine.write).toHaveBeenCalledExactlyOnceWith(DATA);
    await expect(fine.transport.read(3000)).resolves.toBe(answer);
    expect(fine.read).toHaveBeenCalledExactlyOnceWith(3000);
    expect(vi.getTimerCount()).toBe(0);

    const timedOut = new Error("No serial data received.");
    const quiet = fakeTransport({ read: () => Promise.reject(timedOut) });
    await expect(quiet.transport.read(3000)).rejects.toBe(timedOut);
  });

  it("puts no limit on the flash as a whole: every write gets its own time", async () => {
    const { transport } = fakeTransport({
      write: () => new Promise((resolve) => setTimeout(resolve, WRITE_DEADLINE_MS - 1)),
    });
    // Ten blocks that each take nearly all of their time, ten minutes in all.
    for (let block = 0; block < 10; block++) {
      const sent = transport.write(DATA);
      await vi.advanceTimersByTimeAsync(WRITE_DEADLINE_MS - 1);
      await expect(sent).resolves.toBeUndefined();
      // The chip writes the block; nothing is sent meanwhile.
      await vi.advanceTimersByTimeAsync(WRITE_DEADLINE_MS * 2);
    }
    expect(vi.getTimerCount()).toBe(0);
  });

  it("lets go of the port and the transport when it is released", async () => {
    const { transport, device, write, read } = fakeTransport({ write: async () => {} });
    expect(device.listenerCount()).toBe(1);
    releaseTransportGuard(transport);
    expect(device.listenerCount()).toBe(0);
    expect(transport.write).toBe(write);
    expect(transport.read).toBe(read);
    // A chip on its own USB drops off the bus as it resets; that is no failure.
    device.fire();
    await expect(transport.write(DATA)).resolves.toBeUndefined();
    // Released twice, as a failed connect and its caller both do.
    releaseTransportGuard(transport);
  });
});
