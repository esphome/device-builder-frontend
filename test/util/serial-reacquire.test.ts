/**
 * @vitest-environment happy-dom
 *
 * reacquirePort: after a native-USB re-enumeration blip, prefer a fresh
 * getPorts() handle for the same device, fall back to the surviving cached
 * handle, and give up (null) only when the device stays gone past the window
 * or the caller cancels.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { openLiveSerialPort, reacquirePort } from "../../src/util/serial-reacquire.js";
import {
  openLiveSerialPort as openLiveViaBarrel,
  reacquirePort as reacquireViaBarrel,
} from "../../src/util/web-serial.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

function fakePort(
  overrides: Record<string, unknown> = {},
  info: SerialPortInfo = { usbVendorId: 0x303a, usbProductId: 0x1001 }
): SerialPort {
  return { getInfo: () => info, connected: true, ...overrides } as unknown as SerialPort;
}

function stubGetPorts(impl: () => Promise<SerialPort[]>): void {
  (navigator as any).serial = { getPorts: vi.fn(impl) };
}

afterEach(() => {
  delete (navigator as any).serial;
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("reacquirePort", () => {
  it("returns the fresh granted handle for the same device (Chrome re-enum)", async () => {
    const cached = fakePort();
    const fresh = fakePort();
    stubGetPorts(async () => [fresh]);
    expect(await reacquirePort(cached, { timeoutMs: 1000 })).toBe(fresh);
  });

  it("returns the cached handle when it is granted and connected again", async () => {
    const cached = fakePort();
    stubGetPorts(async () => [cached]);
    expect(await reacquirePort(cached, { timeoutMs: 1000 })).toBe(cached);
  });

  it("ignores granted ports for a different device", async () => {
    vi.useFakeTimers();
    const cached = fakePort();
    const other = fakePort({}, { usbVendorId: 0x1a86, usbProductId: 0x7523 });
    stubGetPorts(async () => [other]);
    const pending = reacquirePort(cached, { timeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(1100);
    expect(await pending).toBeNull();
  });

  it("skips a handle whose connected flag is false", async () => {
    vi.useFakeTimers();
    const cached = fakePort({ connected: false });
    stubGetPorts(async () => [cached]);
    const pending = reacquirePort(cached, { timeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(1100);
    expect(await pending).toBeNull();
  });

  it("returns null when the device never reappears within the window", async () => {
    vi.useFakeTimers();
    const cached = fakePort();
    stubGetPorts(async () => []);
    const pending = reacquirePort(cached, { timeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(1100);
    expect(await pending).toBeNull();
  });

  it("rides out a transient getPorts rejection and succeeds on a later round", async () => {
    vi.useFakeTimers();
    const cached = fakePort();
    const fresh = fakePort();
    let calls = 0;
    stubGetPorts(async () => {
      calls++;
      if (calls === 1) throw new DOMException("mid-re-enum", "InvalidStateError");
      return [fresh];
    });
    const pending = reacquirePort(cached, { timeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(300);
    expect(await pending).toBe(fresh);
  });

  it("stops polling as soon as the caller cancels", async () => {
    const cached = fakePort();
    const getPorts = vi.fn(async () => []);
    (navigator as any).serial = { getPorts };
    expect(
      await reacquirePort(cached, { timeoutMs: 1000, cancelled: () => true })
    ).toBeNull();
    expect(getPorts).not.toHaveBeenCalled();
  });
});

describe("openLiveSerialPort", () => {
  it("skips an open candidate whose stream is locked and opens the next", async () => {
    const cached = fakePort({
      readable: null,
      open: vi.fn(async () => {}),
    });
    const locked = fakePort({ readable: { locked: true } });
    stubGetPorts(async () => [locked, cached]);

    const got = await openLiveSerialPort(cached, { baudRate: 115200, timeoutMs: 500 });
    expect(got).toBe(cached);
    expect((cached as any).open).toHaveBeenCalledWith({ baudRate: 115200 });
  });

  it("returns an open unlocked candidate without reopening it", async () => {
    const cached = fakePort({ readable: null, open: vi.fn(async () => {}) });
    const openUnlocked = fakePort({ readable: { locked: false } });
    stubGetPorts(async () => [openUnlocked]);

    const onOpened = vi.fn();
    const got = await openLiveSerialPort(cached, {
      baudRate: 115200,
      timeoutMs: 500,
      onOpened,
    });
    expect(got).toBe(openUnlocked);
    // Found open, not opened here: the caller must not take ownership.
    expect(onOpened).not.toHaveBeenCalled();
  });

  it("skips an open cached handle whose device is gone and takes the fresh one", async () => {
    const dead = fakePort({ readable: { locked: false }, connected: false });
    const fresh = fakePort({ readable: null, open: vi.fn(async () => {}) });
    stubGetPorts(async () => [fresh]);

    const got = await openLiveSerialPort(dead, { baudRate: 115200, timeoutMs: 500 });
    expect(got).toBe(fresh);
    expect((fresh as any).open).toHaveBeenCalledOnce();
  });

  it("reports the handle it opened through onOpened", async () => {
    const cached = fakePort({ readable: null, open: vi.fn(async () => {}) });
    stubGetPorts(async () => []);

    const onOpened = vi.fn();
    const got = await openLiveSerialPort(cached, {
      baudRate: 115200,
      timeoutMs: 500,
      onOpened,
    });
    expect(got).toBe(cached);
    expect(onOpened).toHaveBeenCalledWith(cached);
  });

  it("gives up past the deadline when every candidate stays unopenable", async () => {
    const cached = fakePort({
      readable: null,
      open: vi.fn(async () => {
        throw new DOMException("not ready", "NetworkError");
      }),
    });
    stubGetPorts(async () => []);

    expect(await openLiveSerialPort(cached, { baudRate: 115200, timeoutMs: 1 })).toBe(
      null
    );
  });

  it("forwards bufferSize to open (the 8k logs buffer must survive the reopen)", async () => {
    const cached = fakePort({ readable: null, open: vi.fn(async () => {}) });
    stubGetPorts(async () => []);

    await openLiveSerialPort(cached, {
      baudRate: 115200,
      bufferSize: 8192,
      timeoutMs: 500,
    });
    expect((cached as any).open).toHaveBeenCalledWith({
      baudRate: 115200,
      bufferSize: 8192,
    });
  });

  it("never returns an already-open port whose readable is null", async () => {
    // A fatal read error leaves a port open with readable null; handing it
    // back would just throw at getReader(). The loop must keep retrying.
    const cached = fakePort({
      readable: null,
      open: vi.fn(async () => {
        throw Object.assign(new DOMException("Port already open", "InvalidStateError"));
      }),
    });
    stubGetPorts(async () => []);

    expect(await openLiveSerialPort(cached, { baudRate: 115200, timeoutMs: 1 })).toBe(
      null
    );
  });

  it("stops polling when cancelled", async () => {
    let rounds = 0;
    const cached = fakePort({
      readable: null,
      open: vi.fn(async () => {
        throw new DOMException("not ready", "NetworkError");
      }),
    });
    stubGetPorts(async () => {
      rounds++;
      return [];
    });

    const got = await openLiveSerialPort(cached, {
      baudRate: 115200,
      timeoutMs: 60000,
      cancelled: () => rounds >= 2,
    });
    expect(got).toBe(null);
    expect(rounds).toBeLessThanOrEqual(3);
  });
});

// The web-serial barrel re-exports must stay pointed at these exact
// functions — long-standing import paths depend on the bridge (#1432).
describe("web-serial re-export bridge", () => {
  it("resolves to the same functions as serial-reacquire", () => {
    expect(reacquireViaBarrel).toBe(reacquirePort);
    expect(openLiveViaBarrel).toBe(openLiveSerialPort);
  });
});
