/**
 * @vitest-environment happy-dom
 */
import type { ReactiveControllerHost } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuietTimerController } from "../../src/util/quiet-timer-controller.js";

function makeHost(): ReactiveControllerHost {
  return {
    addController: vi.fn(),
    removeController: vi.fn(),
    requestUpdate: vi.fn(),
    updateComplete: Promise.resolve(true),
  } as unknown as ReactiveControllerHost;
}

describe("QuietTimerController", () => {
  let host: ReactiveControllerHost;
  let timer: QuietTimerController;

  beforeEach(() => {
    vi.useFakeTimers();
    host = makeHost();
    timer = new QuietTimerController(host, 5000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("registers itself on the host", () => {
    expect(host.addController).toHaveBeenCalledWith(timer);
  });

  it("flags quiet with a host update once the window elapses", () => {
    timer.ensureArmed();
    vi.advanceTimersByTime(4999);
    expect(timer.quiet).toBe(false);
    vi.advanceTimersByTime(1);
    expect(timer.quiet).toBe(true);
    expect(host.requestUpdate).toHaveBeenCalled();
  });

  it("ensureArmed while armed keeps the current deadline", () => {
    timer.ensureArmed();
    vi.advanceTimersByTime(4000);
    timer.ensureArmed(); // must not push the deadline out
    vi.advanceTimersByTime(1000);
    expect(timer.quiet).toBe(true);
  });

  it("disarm cancels the pending window", () => {
    timer.ensureArmed();
    timer.disarm();
    vi.advanceTimersByTime(10_000);
    expect(timer.quiet).toBe(false);
  });

  it("disarm clears an already-quiet flag with a host update", () => {
    timer.ensureArmed();
    vi.advanceTimersByTime(5000);
    expect(timer.quiet).toBe(true);
    timer.disarm();
    expect(timer.quiet).toBe(false);
    expect(host.requestUpdate).toHaveBeenCalledTimes(2);
  });

  it("hostDisconnected disarms", () => {
    timer.ensureArmed();
    timer.hostDisconnected();
    vi.advanceTimersByTime(10_000);
    expect(timer.quiet).toBe(false);
  });
});
