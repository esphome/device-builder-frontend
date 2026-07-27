// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner-js", () => ({
  default: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import toast from "sonner-js";
import type { LocalizeFunc } from "../../../src/common/localize.js";
import {
  lazyEnter,
  prefetchLazyRoutes,
  type RouterHooks,
} from "../../../src/components/app-shell/router.js";

/**
 * Pins the lazy-route chunk loader: pending feedback only after the
 * delay, retries on a failed import, cancelled navigation + toast on
 * exhaustion, and idle-scheduled prefetch that never double-schedules.
 */

function makeHooks(): { pendingCalls: boolean[]; hooks: RouterHooks } {
  const pendingCalls: boolean[] = [];
  return {
    pendingCalls,
    hooks: {
      onPending: (pending: boolean) => pendingCalls.push(pending),
      localize: () => ((key: string) => key) as LocalizeFunc,
    },
  };
}

describe("lazyEnter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("resolves without pending feedback when the chunk is fast", async () => {
    const { pendingCalls, hooks } = makeHooks();
    const result = lazyEnter(() => Promise.resolve(), hooks);
    await expect(result).resolves.toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(pendingCalls).toEqual([]);
  });

  it("shows pending feedback only after the delay and clears it on resolve", async () => {
    const { pendingCalls, hooks } = makeHooks();
    let resolveImport!: () => void;
    const gate = new Promise<void>((resolve) => {
      resolveImport = resolve;
    });
    const result = lazyEnter(() => gate, hooks);

    await vi.advanceTimersByTimeAsync(199);
    expect(pendingCalls).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(pendingCalls).toEqual([true]);

    resolveImport();
    await expect(result).resolves.toBe(true);
    expect(pendingCalls).toEqual([true, false]);
  });

  it("retries a failed import and succeeds without a toast", async () => {
    const { hooks } = makeHooks();
    const importThunk = vi
      .fn()
      .mockRejectedValueOnce(new Error("chunk load failed"))
      .mockResolvedValueOnce(undefined);
    const result = lazyEnter(importThunk, hooks);

    await vi.advanceTimersByTimeAsync(500);
    await expect(result).resolves.toBe(true);
    expect(importThunk).toHaveBeenCalledTimes(2);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("cancels the navigation with a toast once the retries are exhausted", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { pendingCalls, hooks } = makeHooks();
    const importThunk = vi.fn().mockRejectedValue(new Error("chunk load failed"));
    const result = lazyEnter(importThunk, hooks);

    await vi.advanceTimersByTimeAsync(500 + 1500);
    await expect(result).resolves.toBe(false);
    expect(importThunk).toHaveBeenCalledTimes(3);
    expect(toast.error).toHaveBeenCalledWith("layout.page_load_failed", {
      richColors: true,
    });
    // The pending bar cleared even though the load never succeeded.
    expect(pendingCalls).toEqual([true, false]);
  });
});

describe("prefetchLazyRoutes", () => {
  it("schedules the warm-up once across repeated calls", () => {
    const requestIdleCallback = vi.fn();
    vi.stubGlobal("requestIdleCallback", requestIdleCallback);
    try {
      prefetchLazyRoutes();
      prefetchLazyRoutes();
      expect(requestIdleCallback).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
