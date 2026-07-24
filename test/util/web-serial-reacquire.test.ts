/**
 * @vitest-environment happy-dom
 *
 * reacquirePort: after a native-USB re-enumeration blip, prefer a fresh
 * getPorts() handle for the same device, fall back to the surviving cached
 * handle, and give up (null) only when the device stays gone past the window
 * or the caller cancels.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { reacquirePort } from "../../src/util/web-serial.js";

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
