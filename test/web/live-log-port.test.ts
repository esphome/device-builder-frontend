// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import { openLiveLogPort } from "../../src/web/flash-receiver/live-log-port.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

const INFO = { usbVendorId: 1, usbProductId: 2 };

function makePort(over: Record<string, unknown> = {}) {
  return {
    getInfo: () => INFO,
    readable: null,
    open: vi.fn(async () => {}),
    ...over,
  };
}

const oldPort = makePort() as any;

function stubGetPorts(ports: unknown[]): void {
  (navigator as any).serial = { getPorts: vi.fn(async () => ports) };
}

afterEach(() => {
  delete (navigator as any).serial;
  vi.clearAllMocks();
});

describe("openLiveLogPort", () => {
  it("returns an already-open, unlocked port without reopening it", async () => {
    const open = makePort({ readable: { locked: false } }) as any;
    stubGetPorts([open]);

    const res = await openLiveLogPort(oldPort, [], 115200, 1000, () => false);

    expect(res.port).toBe(open);
    expect(open.open).not.toHaveBeenCalled();
  });

  it("skips an open-but-locked port and opens the next candidate", async () => {
    const locked = makePort({ readable: { locked: true } }) as any;
    const fresh = makePort({ readable: null }) as any;
    stubGetPorts([locked, fresh]);

    const res = await openLiveLogPort(oldPort, [], 115200, 1000, () => false);

    // The locked handle is unusable (getReader would throw), so it's skipped.
    expect(res.port).toBe(fresh);
    expect(fresh.open).toHaveBeenCalledWith({ baudRate: 115200, bufferSize: 8192 });
  });

  it("stops immediately when asked to", async () => {
    stubGetPorts([]);
    const res = await openLiveLogPort(oldPort, [], 115200, 1000, () => true);
    expect(res.port).toBeNull();
  });
});
