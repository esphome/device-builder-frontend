import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APIError } from "../../src/api/api-error.js";
import {
  LoadAbandonedError,
  loadWithRecovery,
} from "../../src/util/load-with-recovery.js";

/**
 * Pins the flaky-link fetch policy: transport faults retry, server
 * replies are final, and an outage costs no attempts.
 */

describe("loadWithRecovery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns the value without retrying when the first attempt works", async () => {
    const load = vi.fn().mockResolvedValue("yaml");
    await expect(
      loadWithRecovery({ ready: () => Promise.resolve(), load })
    ).resolves.toBe("yaml");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("retries a transport fault after the backoff", async () => {
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error("WebSocket connection closed"))
      .mockResolvedValueOnce("yaml");
    const result = loadWithRecovery({ ready: () => Promise.resolve(), load });

    await vi.advanceTimersByTimeAsync(1500);
    await expect(result).resolves.toBe("yaml");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("rethrows an APIError immediately — the server already answered", async () => {
    const err = new APIError("not_found", "gone");
    const load = vi.fn().mockRejectedValue(err);
    await expect(loadWithRecovery({ ready: () => Promise.resolve(), load })).rejects.toBe(
      err
    );
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("surfaces the transport fault once the attempt budget is spent", async () => {
    const load = vi.fn().mockRejectedValue(new Error("timed out"));
    // Attach the rejection handler before pumping timers, or the failure
    // lands unhandled mid-advance.
    const settled = expect(
      loadWithRecovery({ ready: () => Promise.resolve(), load, attempts: 3 })
    ).rejects.toThrow("timed out");

    await vi.advanceTimersByTimeAsync(1500 * 3);
    await settled;
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("spends no attempts while the connection is down", async () => {
    let release!: () => void;
    const parked = new Promise<void>((resolve) => (release = resolve));
    const load = vi.fn().mockResolvedValue("yaml");
    const result = loadWithRecovery({
      ready: () => parked,
      load,
      attempts: 1,
    });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(load).not.toHaveBeenCalled();

    release();
    await expect(result).resolves.toBe("yaml");
  });

  it("drops a value that resolves after the caller moved on", async () => {
    let abandoned = false;
    let settle!: (v: string) => void;
    const load = vi.fn(() => new Promise<string>((resolve) => (settle = resolve)));
    const settled = expect(
      loadWithRecovery({
        ready: () => Promise.resolve(),
        load,
        abandoned: () => abandoned,
      })
    ).rejects.toBeInstanceOf(LoadAbandonedError);

    await vi.advanceTimersByTimeAsync(0);
    // The id moved on (or the page unmounted) mid-flight; the late reply
    // must not be committed over the newer load's state.
    abandoned = true;
    settle("stale yaml");

    await settled;
  });

  it("abandons instead of retrying once the caller loses interest", async () => {
    const load = vi.fn().mockRejectedValue(new Error("WebSocket closed"));
    let abandoned = false;
    const settled = expect(
      loadWithRecovery({
        ready: () => Promise.resolve(),
        load,
        abandoned: () => abandoned,
      })
    ).rejects.toBeInstanceOf(LoadAbandonedError);

    await vi.advanceTimersByTimeAsync(0);
    abandoned = true;
    await vi.advanceTimersByTimeAsync(1500);

    await settled;
    expect(load).toHaveBeenCalledTimes(1);
  });
});
