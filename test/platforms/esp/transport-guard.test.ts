/**
 * esptool-js bounds its reads, not its writes: a write to a board that was
 * unplugged stayed pending and the flash with it (#1896). The guard ends a
 * write or a line change when the device goes, or does not take it in time.
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
  SerialDeviceLostError,
  SerialWriteStalledError,
} from "../../../src/util/serial-open-error.js";

const never = () => new Promise<void>(() => {});

function fakeTransport(send: () => Promise<void> = never) {
  const device = makeDisconnectPort();
  const transport = {
    device,
    write: vi.fn(send),
    setDTR: vi.fn(send),
    setRTS: vi.fn(send),
  };
  const { write } = transport;
  guardTransport(transport as unknown as Transport);
  return { transport: transport as unknown as Transport, device, write };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("guardTransport", () => {
  it.each(["write", "setDTR", "setRTS"] as const)(
    "fails a %s that never returns when the board is unplugged",
    async (op) => {
      const { transport, device } = fakeTransport();
      const sent = (transport[op] as (arg: never) => Promise<void>)(undefined as never);
      device.fire();
      await expect(sent).rejects.toBeInstanceOf(SerialDeviceLostError);
    }
  );

  it("fails a write at once for a board unplugged before it, without sending", async () => {
    const { transport, device, write } = fakeTransport(async () => {});
    // As during the compile, with the session open and nothing being sent.
    device.fire();
    await expect(transport.write(new Uint8Array(1))).rejects.toBeInstanceOf(
      SerialDeviceLostError
    );
    expect(write).not.toHaveBeenCalled();
  });

  it("fails a write the device does not take by the deadline, naming the seconds", async () => {
    const { transport } = fakeTransport();
    const sent = transport.write(new Uint8Array(1));
    sent.catch(() => {});
    await vi.advanceTimersByTimeAsync(WRITE_DEADLINE_MS - 1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(sent).rejects.toBeInstanceOf(SerialWriteStalledError);
    await expect(sent).rejects.toMatchObject({ seconds: 60 });
  });

  it("hands on a write that returns, and its own failure", async () => {
    const data = new Uint8Array([1, 2]);
    const taken = fakeTransport(async () => {});
    await expect(taken.transport.write(data)).resolves.toBeUndefined();
    expect(taken.write).toHaveBeenCalledExactlyOnceWith(data);
    expect(vi.getTimerCount()).toBe(0);

    const boom = new Error("The port is closed.");
    const refused = fakeTransport(() => Promise.reject(boom));
    await expect(refused.transport.write(data)).rejects.toBe(boom);
  });

  it("puts no limit on the flash as a whole: every write gets its own time", async () => {
    const { transport } = fakeTransport(
      () => new Promise((resolve) => setTimeout(resolve, WRITE_DEADLINE_MS - 1))
    );
    // Ten blocks that each take nearly all of their time, ten minutes in all.
    for (let block = 0; block < 10; block++) {
      const sent = transport.write(new Uint8Array(1));
      await vi.advanceTimersByTimeAsync(WRITE_DEADLINE_MS - 1);
      await expect(sent).resolves.toBeUndefined();
      // The chip writes the block; nothing is sent meanwhile.
      await vi.advanceTimersByTimeAsync(WRITE_DEADLINE_MS * 2);
    }
    expect(vi.getTimerCount()).toBe(0);
  });

  it("lets go of the port and the transport when it is released", async () => {
    const { transport, device, write } = fakeTransport(async () => {});
    expect(device.listenerCount()).toBe(1);
    releaseTransportGuard(transport);
    expect(device.listenerCount()).toBe(0);
    expect(transport.write).toBe(write);
    // A chip on its own USB drops off the bus as it resets; that is no failure.
    device.fire();
    await expect(transport.write(new Uint8Array(1))).resolves.toBeUndefined();
    // Released twice, as a failed connect and its caller both do.
    releaseTransportGuard(transport);
  });
});
