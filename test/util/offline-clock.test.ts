import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeHost } from "../_fake-host.js";
import { OfflineClockController } from "../../src/util/offline-clock.js";
import { formatDuration } from "../../src/util/relative-time.js";

function makeClock(since: number | null = Date.now()) {
  const host = fakeHost();
  const shown = { since };
  const clock = new OfflineClockController(host, () =>
    shown.since === null
      ? null
      : formatDuration((Date.now() - shown.since) / 1000, { language: "en" })
  );
  clock.hostConnected();
  return { host, clock, shown };
}

describe("OfflineClockController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shares one interval that lives only while a host is showing", () => {
    expect(vi.getTimerCount()).toBe(0);
    const a = makeClock();
    const b = makeClock();
    expect(vi.getTimerCount()).toBe(1);

    a.clock.hostDisconnected();
    expect(vi.getTimerCount()).toBe(1);
    b.clock.hostDisconnected();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stays out while the host shows no label", () => {
    makeClock(null);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("leaves when the host stops showing a label", () => {
    const { host, clock, shown } = makeClock();

    // Device came back.
    shown.since = null;
    clock.hostUpdated();

    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(5000);
    expect(host.requestUpdate).not.toHaveBeenCalled();
  });

  it("rejoins when the host is re-attached", () => {
    const { host, clock } = makeClock();
    clock.hostDisconnected();

    clock.hostConnected();
    vi.advanceTimersByTime(1000);

    expect(host.requestUpdate).toHaveBeenCalledTimes(1);
    clock.hostDisconnected();
  });

  it("stays out when an update lands after the host is detached", () => {
    const { clock } = makeClock();
    clock.hostDisconnected();

    clock.hostUpdated();

    expect(vi.getTimerCount()).toBe(0);
  });

  it("repaints only when the label changes", () => {
    const { host, clock } = makeClock();
    const repaints = () => vi.mocked(host.requestUpdate).mock.calls.length;
    // Stand in for the render each repaint triggers.
    vi.mocked(host.requestUpdate).mockImplementation(() => clock.hostUpdated());

    vi.advanceTimersByTime(59_000);
    expect(repaints()).toBe(59);

    vi.advanceTimersByTime(1000);
    expect(repaints()).toBe(60);

    vi.advanceTimersByTime(59_000);
    expect(repaints()).toBe(60);

    vi.advanceTimersByTime(1000);
    expect(repaints()).toBe(61);
    clock.hostDisconnected();
  });
});
