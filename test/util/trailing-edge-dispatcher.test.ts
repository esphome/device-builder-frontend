import { describe, expect, it, vi } from "vitest";
import { TrailingEdgeDispatcher } from "../../src/util/trailing-edge-dispatcher.js";

/**
 * Helper: a runner that resolves only when the test releases it.
 * Lets the test inspect dispatcher state mid-flight.
 */
function deferredRunner() {
  const calls: string[] = [];
  const releases: Array<() => void> = [];
  const runner = (input: string): Promise<void> => {
    calls.push(input);
    return new Promise<void>((resolve) => releases.push(resolve));
  };
  return {
    runner,
    calls,
    /** Release the Nth pending runner call (0-indexed). */
    release: (n: number) => releases[n](),
  };
}

describe("TrailingEdgeDispatcher", () => {
  it("fires immediately when not running", () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const d = new TrailingEdgeDispatcher<string>(fn);

    d.dispatch("a");

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("a");
  });

  it("collapses dispatches during an in-flight call to the latest input", async () => {
    const harness = deferredRunner();
    const d = new TrailingEdgeDispatcher<string>(harness.runner);

    d.dispatch("first");
    d.dispatch("second");
    d.dispatch("third");

    // First call is in flight; "second" overwrote "third"... no wait,
    // "third" overwrote "second". Only the latest input survives in
    // the single pending slot, regardless of how many came in
    // between.
    expect(harness.calls).toEqual(["first"]);

    // Resolve the first run; the trailing-edge replay fires the
    // last input that arrived during the in-flight window.
    harness.release(0);
    await Promise.resolve();
    await Promise.resolve();

    expect(harness.calls).toEqual(["first", "third"]);
  });

  it("does not queue every dispatched input — single-slot pending", async () => {
    const harness = deferredRunner();
    const d = new TrailingEdgeDispatcher<string>(harness.runner);

    d.dispatch("first");
    // 100 mid-flight dispatches collapse to one trailing-edge fire
    // for the latest input. Pin the no-queue contract — a real
    // mutex would replay all 100 in order, this dispatcher must
    // not.
    for (let i = 0; i < 100; i++) {
      d.dispatch(`q${i}`);
    }

    harness.release(0);
    await Promise.resolve();
    await Promise.resolve();

    expect(harness.calls).toEqual(["first", "q99"]);
  });

  it("releases the running flag when the runner resolves", async () => {
    const harness = deferredRunner();
    const d = new TrailingEdgeDispatcher<string>(harness.runner);

    d.dispatch("a");
    expect(d.isRunning).toBe(true);

    harness.release(0);
    await Promise.resolve();
    await Promise.resolve();

    expect(d.isRunning).toBe(false);
  });

  it("releases the running flag when the runner throws", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("boom"));
    const d = new TrailingEdgeDispatcher<string>(fn);

    d.dispatch("a");
    // Wait for the rejection to settle.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(d.isRunning).toBe(false);
  });

  it("releases the running flag when the runner throws synchronously", async () => {
    // Sync throws (TypeError before the runner returns a promise)
    // need the same defence as async rejections — without the
    // try/catch around the call, ``.catch`` on the returned
    // promise wouldn't ever be evaluated and the throw would
    // become an unhandled rejection.
    const fn = vi.fn(() => {
      throw new Error("sync boom");
    });
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const d = new TrailingEdgeDispatcher<string>(
      fn as unknown as (i: string) => Promise<void>
    );

    d.dispatch("a");
    await Promise.resolve();
    await Promise.resolve();

    expect(d.isRunning).toBe(false);
    expect(debugSpy).toHaveBeenCalled();
    debugSpy.mockRestore();
  });

  it("logs a debug breadcrumb when the runner throws", async () => {
    // Pin the swallow-and-log shape: a real runner bug shouldn't
    // surface as an unhandled rejection (the dispatcher is a
    // fire-and-forget call site) but a developer chasing
    // "popup never opens" needs *some* breadcrumb.
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const err = new Error("boom");
    const fn = vi.fn().mockRejectedValue(err);
    const d = new TrailingEdgeDispatcher<string>(fn);

    d.dispatch("a");
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining("TrailingEdgeDispatcher"),
      err
    );
    debugSpy.mockRestore();
  });

  it("cancelPending drops the queued input without firing", async () => {
    const harness = deferredRunner();
    const d = new TrailingEdgeDispatcher<string>(harness.runner);

    d.dispatch("first");
    d.dispatch("second"); // queued
    d.cancelPending();

    harness.release(0);
    await Promise.resolve();
    await Promise.resolve();

    // Only the first call ran — the cancelled pending didn't fire.
    expect(harness.calls).toEqual(["first"]);
  });
});
