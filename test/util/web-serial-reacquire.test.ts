/**
 * @vitest-environment happy-dom
 *
 * reacquirePort: after a native-USB re-enumeration blip, prefer a fresh
 * getPorts() handle for the same device, fall back to the surviving cached
 * handle, and give up (null) only when the device stays gone past the window.
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

function restoreSerial(had: boolean, prev: unknown): () => void {
  return () => {
    if (had) {
      Object.defineProperty(navigator, "serial", { configurable: true, value: prev });
    } else {
      delete (navigator as any).serial;
    }
  };
}

function withGetPorts(impl: () => Promise<SerialPort[]>): () => void {
  const restore = restoreSerial("serial" in navigator, (navigator as any).serial);
  Object.defineProperty(navigator, "serial", {
    configurable: true,
    value: { getPorts: vi.fn(impl) },
  });
  return restore;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("reacquirePort", () => {
  it("returns the fresh granted handle for the same device (Chrome re-enum)", async () => {
    const cached = fakePort();
    const fresh = fakePort();
    const restore = withGetPorts(async () => [fresh]);
    try {
      expect(await reacquirePort(cached, 1000)).toBe(fresh);
    } finally {
      restore();
    }
  });

  it("returns the cached handle when it is granted and connected again", async () => {
    const cached = fakePort();
    const restore = withGetPorts(async () => [cached]);
    try {
      expect(await reacquirePort(cached, 1000)).toBe(cached);
    } finally {
      restore();
    }
  });

  it("ignores granted ports for a different device", async () => {
    vi.useFakeTimers();
    const cached = fakePort();
    const other = fakePort({}, { usbVendorId: 0x1a86, usbProductId: 0x7523 });
    const restore = withGetPorts(async () => [other]);
    try {
      const pending = reacquirePort(cached, 1000);
      await vi.advanceTimersByTimeAsync(1100);
      expect(await pending).toBeNull();
    } finally {
      restore();
      vi.useRealTimers();
    }
  });

  it("skips a handle whose connected flag is false", async () => {
    vi.useFakeTimers();
    const cached = fakePort({ connected: false });
    const restore = withGetPorts(async () => [cached]);
    try {
      const pending = reacquirePort(cached, 1000);
      await vi.advanceTimersByTimeAsync(1100);
      expect(await pending).toBeNull();
    } finally {
      restore();
      vi.useRealTimers();
    }
  });

  it("returns null when the device never reappears within the window", async () => {
    vi.useFakeTimers();
    const cached = fakePort();
    const restore = withGetPorts(async () => []);
    try {
      const pending = reacquirePort(cached, 1000);
      await vi.advanceTimersByTimeAsync(1100);
      expect(await pending).toBeNull();
    } finally {
      restore();
      vi.useRealTimers();
    }
  });

  it("rides out a transient getPorts rejection and succeeds on a later round", async () => {
    vi.useFakeTimers();
    const cached = fakePort();
    const fresh = fakePort();
    let calls = 0;
    const restore = withGetPorts(async () => {
      calls++;
      if (calls === 1) throw new DOMException("mid-re-enum", "InvalidStateError");
      return [fresh];
    });
    try {
      const pending = reacquirePort(cached, 1000);
      await vi.advanceTimersByTimeAsync(300);
      expect(await pending).toBe(fresh);
    } finally {
      restore();
      vi.useRealTimers();
    }
  });
});
