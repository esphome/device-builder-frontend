// Pins the shared relative-time ticker: anchor reset on start, host
// updates per tick, stop/auto-stop, and the autoStart lifecycle.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NowTickController } from "../../src/util/now-tick-controller.js";
import { FakeHost } from "../_fake-host.js";

describe("NowTickController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("re-anchors now on start and ticks the host on the interval", () => {
    const host = new FakeHost();
    const ticker = new NowTickController(host, { intervalMs: 1000 });
    const anchor = ticker.now;
    vi.advanceTimersByTime(5000);
    expect(ticker.now).toBe(anchor);
    ticker.start();
    const updatesAfterStart = host.updates;
    vi.advanceTimersByTime(3000);
    expect(ticker.now).toBeGreaterThan(anchor);
    expect(host.updates).toBe(updatesAfterStart + 3);
  });

  it("stop halts ticking and start is idempotent while running", () => {
    const host = new FakeHost();
    const ticker = new NowTickController(host, { intervalMs: 1000 });
    ticker.start();
    const updatesAfterFirstStart = host.updates;
    ticker.start();
    expect(host.updates).toBe(updatesAfterFirstStart);
    vi.advanceTimersByTime(1000);
    const updates = host.updates;
    ticker.stop();
    vi.advanceTimersByTime(5000);
    expect(host.updates).toBe(updates);
  });

  it("autoStart runs on hostConnected and stops on hostDisconnected", () => {
    const host = new FakeHost();
    const ticker = new NowTickController(host, { intervalMs: 1000, autoStart: true });
    ticker.hostConnected();
    const updates = host.updates;
    vi.advanceTimersByTime(2000);
    expect(host.updates).toBe(updates + 2);
    ticker.hostDisconnected();
    vi.advanceTimersByTime(5000);
    expect(host.updates).toBe(updates + 2);
  });
});
