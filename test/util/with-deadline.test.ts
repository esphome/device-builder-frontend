import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { settledWithin, withDeadline } from "../../src/util/with-deadline.js";

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

  it("swallows the abandoned work's late rejection", async () => {
    let fail: (err: Error) => void = () => {};
    const work = new Promise<void>((_, reject) => (fail = reject));
    const result = withDeadline(work, 1000, () => new Error("late"));
    const assertion = expect(result).rejects.toThrow("late");
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    fail(new Error("too late to matter")); // nobody listens; no unhandled rejection
    await vi.advanceTimersByTimeAsync(0);
  });
});

describe("settledWithin", () => {
  it("is true for work that settles in time, either way", async () => {
    await expect(settledWithin(Promise.resolve(), 1000)).resolves.toBe(true);
    await expect(settledWithin(Promise.reject(new Error("x")), 1000)).resolves.toBe(true);
  });

  it("is false for work still pending at the deadline", async () => {
    const result = settledWithin(new Promise(() => {}), 1000);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(result).resolves.toBe(false);
  });

  it("clears its timer once the work settles", async () => {
    await settledWithin(Promise.resolve(), 1000);
    expect(vi.getTimerCount()).toBe(0);
  });
});
