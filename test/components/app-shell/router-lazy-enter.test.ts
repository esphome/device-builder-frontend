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
import { identityLocalize } from "../../_dom.js";

/**
 * Pins the lazy-route chunk loader: pending feedback only after the
 * delay, retries on a failed import, cancelled navigation + toast on
 * exhaustion, and idle-scheduled prefetch.
 */

function makeHooks(): { pendingCalls: boolean[]; hooks: RouterHooks } {
  const pendingCalls: boolean[] = [];
  return {
    pendingCalls,
    hooks: {
      onPending: (pending: boolean) => pendingCalls.push(pending),
      localize: () => identityLocalize as LocalizeFunc,
    },
  };
}

describe("lazyEnter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.history.pushState({}, "", "/device/kitchen.yaml");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    window.history.pushState({}, "", "/");
  });

  it("resolves without showing pending when the chunk is fast", async () => {
    const { pendingCalls, hooks } = makeHooks();
    const result = lazyEnter(() => Promise.resolve(), hooks);
    await expect(result).resolves.toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    // Never crossed the delay, so it never joined the pending count.
    expect(pendingCalls).toEqual([]);
  });

  it("shows pending only after the delay and clears it on resolve", async () => {
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

  it("refuses to commit a chunk that lands after the user navigated away", async () => {
    const { hooks } = makeHooks();
    let resolveImport!: () => void;
    const gate = new Promise<void>((resolve) => {
      resolveImport = resolve;
    });
    const result = lazyEnter(() => gate, hooks);

    // User gave up on the slow route and went back to the dashboard.
    window.history.pushState({}, "", "/");
    resolveImport();

    await expect(result).resolves.toBe(false);
  });

  it("abandons the retry loop when the location moves on mid-backoff", async () => {
    const { hooks } = makeHooks();
    const importThunk = vi.fn().mockRejectedValue(new Error("chunk load failed"));
    const result = lazyEnter(importThunk, hooks);

    window.history.pushState({}, "", "/somewhere-else");
    await vi.advanceTimersByTimeAsync(2000);

    await expect(result).resolves.toBe(false);
    // Bailed on the first failure instead of burning both retries.
    expect(importThunk).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("keeps the bar up until the last overlapping load settles", async () => {
    const { pendingCalls, hooks } = makeHooks();
    let resolveFirst!: () => void;
    let resolveSecond!: () => void;
    const first = lazyEnter(
      () => new Promise<void>((resolve) => (resolveFirst = resolve)),
      hooks
    );
    const second = lazyEnter(
      () => new Promise<void>((resolve) => (resolveSecond = resolve)),
      hooks
    );

    await vi.advanceTimersByTimeAsync(200);
    // Both crossed the delay; the bar is shown once, not twice.
    expect(pendingCalls).toEqual([true]);

    resolveFirst();
    await first;
    expect(pendingCalls).toEqual([true]);

    resolveSecond();
    await second;
    expect(pendingCalls).toEqual([true, false]);
  });

  it("does not show the bar for a navigation abandoned before the delay", async () => {
    const { pendingCalls, hooks } = makeHooks();
    const result = lazyEnter(() => new Promise<void>(() => {}), hooks);

    window.history.pushState({}, "", "/");
    await vi.advanceTimersByTimeAsync(400);

    // The import can't be cancelled, but the feedback shouldn't advertise
    // progress on a page the user already left.
    expect(pendingCalls).toEqual([]);
    void result;
  });

  it("cancels the navigation with a toast once the retries are exhausted", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
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
    // navigate() had already pushed the URL; undo it so the address bar
    // doesn't describe a page that never mounted.
    expect(back).toHaveBeenCalledTimes(1);
  });
});

describe("prefetchLazyRoutes", () => {
  it("defers the warm-up to an idle callback", () => {
    const requestIdleCallback = vi.fn();
    vi.stubGlobal("requestIdleCallback", requestIdleCallback);
    try {
      prefetchLazyRoutes();
      expect(requestIdleCallback).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
