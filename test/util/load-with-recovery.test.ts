import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APIError } from "../../src/api/api-error.js";
import type { ESPHomeAPI } from "../../src/api/index.js";
import {
  loadConfigWithRecovery,
  LoadDeadlineError,
} from "../../src/util/load-with-recovery.js";

/**
 * Pins the flaky-link fetch policy: transport faults retry, server
 * replies are final, and an outage costs no attempts.
 */

function makeApi(
  getConfig: ReturnType<typeof vi.fn>,
  ready: Promise<void> = Promise.resolve()
): ESPHomeAPI {
  return { ready, getConfig } as unknown as ESPHomeAPI;
}

describe("loadConfigWithRecovery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns the config without retrying when the first attempt works", async () => {
    const getConfig = vi.fn().mockResolvedValue("yaml");
    await expect(
      loadConfigWithRecovery(makeApi(getConfig), "kitchen.yaml", { attempts: 4 })
    ).resolves.toBe("yaml");
    expect(getConfig).toHaveBeenCalledTimes(1);
  });

  it("retries a transport fault after the backoff", async () => {
    const getConfig = vi
      .fn()
      .mockRejectedValueOnce(new Error("WebSocket connection closed"))
      .mockResolvedValueOnce("yaml");
    const result = loadConfigWithRecovery(makeApi(getConfig), "kitchen.yaml", {
      attempts: 4,
    });

    await vi.advanceTimersByTimeAsync(1500);
    await expect(result).resolves.toBe("yaml");
    expect(getConfig).toHaveBeenCalledTimes(2);
  });

  it("rethrows an APIError immediately — the server already answered", async () => {
    const err = new APIError("not_found", "gone");
    const getConfig = vi.fn().mockRejectedValue(err);
    await expect(
      loadConfigWithRecovery(makeApi(getConfig), "kitchen.yaml", { attempts: 4 })
    ).rejects.toBe(err);
    expect(getConfig).toHaveBeenCalledTimes(1);
  });

  it("surfaces the transport fault once the attempt budget is spent", async () => {
    const getConfig = vi.fn().mockRejectedValue(new Error("timed out"));
    // Attach the rejection handler before pumping timers, or the failure
    // lands unhandled mid-advance.
    const settled = expect(
      loadConfigWithRecovery(makeApi(getConfig), "kitchen.yaml", { attempts: 3 })
    ).rejects.toThrow("timed out");

    await vi.advanceTimersByTimeAsync(1500 * 3);
    await settled;
    expect(getConfig).toHaveBeenCalledTimes(3);
  });

  it("spends no attempts while the connection is down", async () => {
    let release!: () => void;
    const parked = new Promise<void>((resolve) => (release = resolve));
    const getConfig = vi.fn().mockResolvedValue("yaml");
    const result = loadConfigWithRecovery(makeApi(getConfig, parked), "kitchen.yaml", {
      attempts: 1,
    });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(getConfig).not.toHaveBeenCalled();

    release();
    await expect(result).resolves.toBe("yaml");
  });

  it("drops a value that resolves after the caller moved on", async () => {
    let abandoned = false;
    let settle!: (v: string) => void;
    const getConfig = vi.fn(() => new Promise<string>((resolve) => (settle = resolve)));
    const result = loadConfigWithRecovery(makeApi(getConfig), "kitchen.yaml", {
      attempts: 4,
      abandoned: () => abandoned,
    });

    await vi.advanceTimersByTimeAsync(0);
    // The id moved on (or the page unmounted) mid-flight; the late reply
    // must not be committed over the newer load's state.
    abandoned = true;
    settle("stale yaml");

    await expect(result).resolves.toBeNull();
  });

  it("drops a rejection that lands after the caller moved on", async () => {
    let abandoned = false;
    let fail!: (err: Error) => void;
    const getConfig = vi.fn(
      () => new Promise<string>((_resolve, reject) => (fail = reject))
    );
    const result = loadConfigWithRecovery(makeApi(getConfig), "kitchen.yaml", {
      attempts: 4,
      abandoned: () => abandoned,
    });

    await vi.advanceTimersByTimeAsync(0);
    // A reused element has moved to the next id; the old load's terminal
    // failure must not paint an error state over it.
    abandoned = true;
    fail(new APIError("not_found", "gone"));

    await expect(result).resolves.toBeNull();
  });

  it("fails with LoadDeadlineError when the deadline elapses mid-park", async () => {
    let release!: () => void;
    const parked = new Promise<void>((resolve) => (release = resolve));
    const getConfig = vi.fn().mockResolvedValue("yaml");
    const settled = expect(
      loadConfigWithRecovery(makeApi(getConfig, parked), "kitchen.yaml", {
        attempts: 4,
        deadlineMs: 30_000,
      })
    ).rejects.toBeInstanceOf(LoadDeadlineError);

    await vi.advanceTimersByTimeAsync(30_000);
    await settled;

    // The loop exits at its next checkpoint instead of issuing the read.
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(getConfig).not.toHaveBeenCalled();
  });

  it("clears the deadline on a fast success", async () => {
    const getConfig = vi.fn().mockResolvedValue("yaml");
    await expect(
      loadConfigWithRecovery(makeApi(getConfig), "kitchen.yaml", {
        attempts: 4,
        deadlineMs: 30_000,
      })
    ).resolves.toBe("yaml");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops retrying once the caller loses interest", async () => {
    const getConfig = vi.fn().mockRejectedValue(new Error("WebSocket closed"));
    let abandoned = false;
    const result = loadConfigWithRecovery(makeApi(getConfig), "kitchen.yaml", {
      attempts: 4,
      abandoned: () => abandoned,
    });

    await vi.advanceTimersByTimeAsync(0);
    abandoned = true;
    await vi.advanceTimersByTimeAsync(1500);

    await expect(result).resolves.toBeNull();
    // Bailed before spending the backoff, not after it.
    expect(getConfig).toHaveBeenCalledTimes(1);
  });
});
