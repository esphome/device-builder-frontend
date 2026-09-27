/**
 * A write or an erase ends when the device goes away or goes quiet, in place
 * of waiting on a write that never returns (#1896).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  whileDevicePresent,
  WRITE_STALL_MS,
} from "../../../src/platforms/esp/device-present.js";
import {
  SerialDeviceLostError,
  SerialWriteStalledError,
} from "../../../src/util/serial-open-error.js";

/** A port that can be unplugged, counting who listens for it. */
function fakePort() {
  const target = new EventTarget();
  let listeners = 0;
  return {
    port: {
      addEventListener: (type: string, l: EventListener) => {
        listeners++;
        target.addEventListener(type, l);
      },
      removeEventListener: (type: string, l: EventListener) => {
        listeners--;
        target.removeEventListener(type, l);
      },
    } as unknown as SerialPort,
    unplug: () => target.dispatchEvent(new Event("disconnect")),
    listeners: () => listeners,
  };
}

const never = () => new Promise<never>(() => {});

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("whileDevicePresent", () => {
  it("fails a write that never returns when the device is unplugged", async () => {
    const { port, unplug, listeners } = fakePort();
    const write = whileDevicePresent(port, never, WRITE_STALL_MS);
    unplug();
    await expect(write).rejects.toBeInstanceOf(SerialDeviceLostError);
    expect(listeners()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("fails a write that made no progress for the window, naming the seconds", async () => {
    const { port, listeners } = fakePort();
    const write = whileDevicePresent(port, never, WRITE_STALL_MS);
    write.catch(() => {});
    await vi.advanceTimersByTimeAsync(WRITE_STALL_MS);
    await expect(write).rejects.toBeInstanceOf(SerialWriteStalledError);
    await expect(write).rejects.toMatchObject({ seconds: 60 });
    expect(listeners()).toBe(0);
  });

  it("starts the window again with every progress", async () => {
    const { port } = fakePort();
    let progressed = (): void => {};
    let failed = false;
    whileDevicePresent(
      port,
      (guard) => {
        progressed = guard.progressed;
        return never();
      },
      WRITE_STALL_MS
    ).catch(() => (failed = true));

    await vi.advanceTimersByTimeAsync(WRITE_STALL_MS - 1);
    progressed();
    await vi.advanceTimersByTimeAsync(WRITE_STALL_MS - 1);
    expect(failed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(failed).toBe(true);
  });

  it("hands on the work's own result and failure, and lets go of the port", async () => {
    const { port, listeners } = fakePort();
    await expect(whileDevicePresent(port, async () => 7, WRITE_STALL_MS)).resolves.toBe(
      7
    );
    const boom = new Error("Invalid head of packet");
    await expect(
      whileDevicePresent(port, () => Promise.reject(boom), WRITE_STALL_MS)
    ).rejects.toBe(boom);
    expect(listeners()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("tells the work it was given up on, so its late progress is dropped", async () => {
    const { port, unplug } = fakePort();
    let live = (): boolean => true;
    const write = whileDevicePresent(
      port,
      (guard) => {
        live = guard.live;
        return never();
      },
      WRITE_STALL_MS
    );
    expect(live()).toBe(true);
    unplug();
    await expect(write).rejects.toBeInstanceOf(SerialDeviceLostError);
    expect(live()).toBe(false);
  });

  it("gives an erase no window: it reports nothing and takes its time", async () => {
    const { port, unplug } = fakePort();
    let failed: unknown;
    whileDevicePresent(port, never).catch((err: unknown) => (failed = err));
    await vi.advanceTimersByTimeAsync(WRITE_STALL_MS * 10);
    expect(failed).toBeUndefined();
    unplug();
    await vi.advanceTimersByTimeAsync(0);
    expect(failed).toBeInstanceOf(SerialDeviceLostError);
  });
});
