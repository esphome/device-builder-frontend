import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { debounce } from "../../src/util/debounce.js";

describe("debounce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("invokes the function only after the delay elapses", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);
    debounced();
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("collapses rapid calls into a single invocation", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 50);
    debounced();
    debounced();
    debounced();
    vi.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("passes the latest arguments to the wrapped function", () => {
    const fn = vi.fn();
    const debounced = debounce(fn as (...args: unknown[]) => void, 10);
    debounced("first");
    debounced("second");
    vi.advanceTimersByTime(10);
    expect(fn).toHaveBeenCalledWith("second");
  });

  it("starts a fresh timer when called after the delay", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 20);
    debounced();
    vi.advanceTimersByTime(20);
    debounced();
    vi.advanceTimersByTime(20);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
