/**
 * @vitest-environment happy-dom
 *
 * Pins the LineBatcher contract: one append per frame regardless of line
 * count, flush drains immediately, reset drops pending lines and cancels
 * the scheduled frame.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { LineBatcher } from "../../src/util/line-batcher.js";

function withManualRaf() {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    frames.push(cb);
    return frames.length;
  });
  const cancelled: number[] = [];
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    cancelled.push(id);
  });
  return {
    frames,
    cancelled,
    fire: () => {
      const pending = frames.splice(0);
      for (const cb of pending) cb(0);
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("LineBatcher", () => {
  it("coalesces many enqueues into one append per frame", () => {
    const raf = withManualRaf();
    const append = vi.fn();
    const batcher = new LineBatcher(append);
    batcher.enqueue("a");
    batcher.enqueue("b");
    batcher.enqueue("c");
    expect(append).not.toHaveBeenCalled();
    expect(raf.frames).toHaveLength(1); // one frame scheduled, not three
    raf.fire();
    expect(append).toHaveBeenCalledTimes(1);
    expect(append).toHaveBeenCalledWith(["a", "b", "c"]);
  });

  it("flush drains immediately and the later frame is a no-op", () => {
    const raf = withManualRaf();
    const append = vi.fn();
    const batcher = new LineBatcher(append);
    batcher.enqueue("a");
    batcher.flush();
    expect(append).toHaveBeenCalledWith(["a"]);
    raf.fire();
    expect(append).toHaveBeenCalledTimes(1); // nothing left to append
  });

  it("reset drops pending lines and cancels the scheduled frame", () => {
    const raf = withManualRaf();
    const append = vi.fn();
    const batcher = new LineBatcher(append);
    batcher.enqueue("a");
    batcher.reset();
    expect(raf.cancelled).toHaveLength(1);
    raf.fire();
    batcher.flush();
    expect(append).not.toHaveBeenCalled();
  });

  it("keeps batching across frames", () => {
    const raf = withManualRaf();
    const lines: string[] = [];
    const batcher = new LineBatcher((batch) => lines.push(...batch));
    batcher.enqueue("a");
    raf.fire();
    batcher.enqueue("b");
    batcher.enqueue("c");
    raf.fire();
    expect(lines).toEqual(["a", "b", "c"]);
  });

  it("buffers nothing at a maxLines of 0, rather than trimming by a negative zero", () => {
    // slice(-0) is slice(0), which keeps everything: the trim would run on
    // every push and drop nothing, so a hidden tab would buffer without bound.
    withManualRaf();
    const append = vi.fn();
    const batcher = new LineBatcher(append, { maxLines: 0 });
    for (let i = 0; i < 500; i++) batcher.enqueue(String(i));
    batcher.flush();
    expect(append).not.toHaveBeenCalled();
  });

  it("maxLines bounds the pending buffer when frames never fire (hidden tab)", () => {
    const raf = withManualRaf();
    const append = vi.fn();
    const batcher = new LineBatcher(append, { maxLines: 100 });
    for (let i = 0; i < 250; i++) batcher.enqueue(String(i));
    raf.fire();
    expect(append).toHaveBeenCalledTimes(1);
    const batch = append.mock.calls[0][0] as string[];
    // Trimmed once at 201 pushes (headroom = 2 × maxLines) down to the
    // newest 100, then grew again: 101..249 survive, 0..100 dropped.
    expect(batch).toHaveLength(149);
    expect(batch[0]).toBe("101");
    expect(batch[batch.length - 1]).toBe("249");
  });
});
