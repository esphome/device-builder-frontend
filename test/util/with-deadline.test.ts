import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { withDeadline } from "../../src/util/with-deadline.js";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("withDeadline", () => {
  it("passes the work's result through inside the deadline", async () => {
    await expect(
      withDeadline(Promise.resolve("ok"), 1000, () => new Error("late"))
    ).resolves.toBe("ok");
  });

  it("passes the work's rejection through inside the deadline", async () => {
    await expect(
      withDeadline(Promise.reject(new Error("boom")), 1000, () => new Error("late"))
    ).rejects.toThrow("boom");
  });

  it("rejects with the timeout's error once the deadline passes", async () => {
    const never = new Promise<string>(() => {});
    const result = withDeadline(never, 1000, () => new Error("late"));
    const assertion = expect(result).rejects.toThrow("late");
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  it("clears its timer once the work settles", async () => {
    await withDeadline(Promise.resolve(1), 1000, () => new Error("late"));
    expect(vi.getTimerCount()).toBe(0);
  });
});
