/**
 * @vitest-environment happy-dom
 *
 * Pins the LogBuffer contract: the cap trims from the front and moves
 * tracked positions with it, replace verifies before writing, and reset
 * bumps the epoch.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeHost } from "../_fake-host.js";
import { LogBuffer } from "../../src/util/log-buffer.js";

function withManualRaf() {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    frames.push(cb);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  return {
    frames,
    fire: () => {
      const pending = frames.splice(0);
      for (const cb of pending) cb(0);
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("LogBuffer", () => {
  it("appends and reports the stream position of the batch", () => {
    const buf = new LogBuffer(new FakeHost());
    expect(buf.append(["a", "b"])).toBe(0);
    expect(buf.append(["c"])).toBe(2);
    expect(buf.lines).toEqual(["a", "b", "c"]);
  });

  it("hands each batch to onAppend with its starting position", () => {
    const onAppend = vi.fn();
    const buf = new LogBuffer(new FakeHost(), { onAppend });
    buf.append(["a", "b"]);
    buf.append(["c"]);
    expect(onAppend.mock.calls).toEqual([
      [["a", "b"], 0],
      [["c"], 2],
    ]);
  });

  it("requests a host update per mutation so Lit repaints", () => {
    const host = new FakeHost();
    const buf = new LogBuffer(host);
    buf.append(["a"]);
    expect(host.updates).toBe(1);
    buf.reset();
    expect(host.updates).toBe(2);
  });

  it("hands out a fresh array per mutation, so a Lit binding sees the change", () => {
    const buf = new LogBuffer(new FakeHost());
    buf.append(["a"]);
    const first = buf.lines;
    buf.append(["b"]);
    expect(buf.lines).not.toBe(first);
    expect(first).toEqual(["a"]); // the old identity wasn't mutated under it
  });

  it("is unbounded without maxLines", () => {
    const buf = new LogBuffer(new FakeHost());
    for (let i = 0; i < 300; i++) buf.append([String(i)]);
    expect(buf.lines).toHaveLength(300);
  });

  it("caps to the newest maxLines, dropping from the front", () => {
    const buf = new LogBuffer(new FakeHost(), { maxLines: 100 });
    for (let i = 0; i < 105; i++) buf.append([String(i)]);
    expect(buf.lines).toHaveLength(100);
    expect(buf.lines[0]).toBe("5");
    expect(buf.lines[99]).toBe("104");
  });

  it("retains nothing at a maxLines of 0, rather than trimming by a negative zero", () => {
    // slice(-0) is slice(0), which keeps the whole array while the shift says
    // every line went — the buffer would look full and resolve no position.
    const buf = new LogBuffer(new FakeHost(), { maxLines: 0 });
    buf.append(["a", "b"]);
    expect(buf.lines).toEqual([]);
    expect(buf.indexOf(0, ["a"])).toBeNull();
  });

  it("buffers nothing at a maxLines of 0 either, so a hidden tab can't grow it", () => {
    // maxLines is forwarded to the batcher, which hit the same negative zero:
    // rAF doesn't fire while the tab is hidden, so an untrimmed pending buffer
    // grows for as long as the device talks.
    const raf = withManualRaf();
    const onAppend = vi.fn();
    const buf = new LogBuffer(new FakeHost(), { maxLines: 0, onAppend });
    for (let i = 0; i < 500; i++) buf.enqueue(String(i));
    raf.fire();
    expect(buf.lines).toEqual([]);
    expect(onAppend).not.toHaveBeenCalled();
  });

  it("moves tracked positions by what the cap trimmed", () => {
    const buf = new LogBuffer(new FakeHost(), { maxLines: 100 });
    for (let i = 0; i < 100; i++) buf.append([String(i)]);
    expect(buf.indexOf(40, ["40"])).toBe(40);
    buf.append(["100", "101", "102", "103", "104"]); // trims the oldest five
    expect(buf.indexOf(40, ["40"])).toBe(35);
  });

  it("maxLines bounds the pending buffer when frames never fire (hidden tab)", () => {
    // The batcher trims its own pending buffer at 2 * maxLines, so a flood
    // into a backgrounded tab can't grow without bound. Observed through the
    // batch that lands, not the batcher's internals.
    const raf = withManualRaf();
    const onAppend = vi.fn();
    const buf = new LogBuffer(new FakeHost(), { maxLines: 100, onAppend });
    for (let i = 0; i < 250; i++) buf.enqueue(String(i));
    expect(buf.lines).toHaveLength(0); // nothing painted without a frame
    raf.fire();
    const batch = onAppend.mock.calls[0][0] as string[];
    // Bounded, not 250. The exact figure is the batcher's headroom heuristic
    // and free to change; that it stays bounded is the contract.
    expect(batch.length).toBeLessThanOrEqual(200); // 2 * maxLines
    expect(batch[batch.length - 1]).toBe("249"); // newest retained
  });

  it("flush drains buffered lines immediately", () => {
    withManualRaf();
    const buf = new LogBuffer(new FakeHost());
    buf.enqueue("a");
    expect(buf.lines).toHaveLength(0);
    buf.flush();
    expect(buf.lines).toEqual(["a"]);
  });

  it("dropPending drops the batch but keeps the lines already shown", () => {
    const raf = withManualRaf();
    const buf = new LogBuffer(new FakeHost());
    buf.append(["shown"]);
    buf.enqueue("buffered");
    buf.dropPending();
    raf.fire();
    expect(buf.lines).toEqual(["shown"]);
  });

  it("reset drops the lines, the pending batch, and the position map", () => {
    const raf = withManualRaf();
    const buf = new LogBuffer(new FakeHost());
    buf.append(["a", "b"]);
    buf.enqueue("c");
    buf.reset();
    raf.fire();
    expect(buf.lines).toEqual([]);
    // Stream positions restart, so the next line is position 0 again.
    expect(buf.append(["fresh"])).toBe(0);
    expect(buf.indexOf(0, ["fresh"])).toBe(0);
  });

  it("reset bumps the epoch so work in flight can drop itself", () => {
    const buf = new LogBuffer(new FakeHost());
    const before = buf.epoch;
    buf.reset();
    expect(buf.epoch).not.toBe(before);
  });

  describe("indexOf", () => {
    it("finds a run at its tracked position", () => {
      const buf = new LogBuffer(new FakeHost());
      buf.append(["a", "b", "c"]);
      expect(buf.indexOf(1, ["b", "c"])).toBe(1);
    });

    it("returns null for a run whose head the cap dropped", () => {
      const buf = new LogBuffer(new FakeHost(), { maxLines: 3 });
      buf.append(["a", "b"]);
      buf.append(["c", "d", "e"]); // "a"/"b" trimmed out
      expect(buf.indexOf(0, ["a", "b"])).toBeNull();
    });

    it("returns null for a run that runs past the end", () => {
      const buf = new LogBuffer(new FakeHost());
      buf.append(["a"]);
      expect(buf.indexOf(0, ["a", "b"])).toBeNull();
    });

    it("verifies every line, not just the ends", () => {
      // A crash loop repeats one dump verbatim, so two runs share a first and
      // last line; an ends-only check would accept the wrong one.
      const buf = new LogBuffer(new FakeHost());
      buf.append(["head", "MIDDLE", "tail"]);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        expect(buf.indexOf(0, ["head", "other", "tail"])).toBeNull();
      } finally {
        warn.mockRestore();
      }
    });

    it("says so when a run is in bounds but not there", () => {
      const buf = new LogBuffer(new FakeHost());
      buf.append(["a", "b"]);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        expect(buf.indexOf(0, ["x", "y"])).toBeNull();
        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining("not at its tracked position"),
          0
        );
      } finally {
        warn.mockRestore();
      }
    });

    it("stays quiet for the ordinary out-of-bounds case", () => {
      const buf = new LogBuffer(new FakeHost(), { maxLines: 2 });
      buf.append(["a", "b"]);
      buf.append(["c", "d"]);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        expect(buf.indexOf(0, ["a", "b"])).toBeNull();
        expect(warn).not.toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    });
  });

  describe("replace", () => {
    it("swaps a run and reports success", () => {
      const buf = new LogBuffer(new FakeHost());
      buf.append(["a", "b", "c"]);
      expect(buf.replace(1, ["b"], ["B1", "B2"])).toBe(true);
      expect(buf.lines).toEqual(["a", "B1", "B2", "c"]);
    });

    it("moves later positions by the lines it inserted", () => {
      const buf = new LogBuffer(new FakeHost());
      buf.append(["a", "b"]);
      buf.replace(0, ["a"], ["A1", "A2"]); // one line becomes two
      buf.append(["c"]);
      expect(buf.lines).toEqual(["A1", "A2", "b", "c"]);
      expect(buf.indexOf(2, ["c"])).toBe(3);
    });

    it("costs every position up to the one it rewrote, which is why only the newest may be", () => {
      // The documented precondition, demonstrated. The single shift is only
      // true of the positions after the rewrite, so an out-of-order one leaves
      // the earlier positions resolving nowhere rather than resolving wrong.
      const buf = new LogBuffer(new FakeHost());
      buf.append(["a", "b", "c", "d"]);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        buf.replace(2, ["c"], ["c1", "c2", "c3"]); // not the newest; changes length
        expect(buf.lines).toEqual(["a", "b", "c1", "c2", "c3", "d"]);
        expect(buf.indexOf(0, ["a"])).toBeNull(); // before it: lost
        expect(buf.indexOf(2, ["c1"])).toBeNull(); // itself: lost
        expect(buf.indexOf(3, ["d"])).toBe(5); // after it: still right
      } finally {
        warn.mockRestore();
      }
    });

    it("leaves the buffer alone when the run isn't there", () => {
      const buf = new LogBuffer(new FakeHost());
      buf.append(["a", "b"]);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        expect(buf.replace(0, ["x", "y"], ["z"])).toBe(false);
      } finally {
        warn.mockRestore();
      }
      expect(buf.lines).toEqual(["a", "b"]);
    });

    it("applies the cap to what it inserted", () => {
      const buf = new LogBuffer(new FakeHost(), { maxLines: 3 });
      buf.append(["a", "b", "c"]);
      // Expanding "c" into three lines overflows the cap by two.
      expect(buf.replace(2, ["c"], ["c1", "c2", "c3"])).toBe(true);
      expect(buf.lines).toEqual(["c1", "c2", "c3"]);
    });

    it("keeps positions right when a replace overflows the cap", () => {
      const buf = new LogBuffer(new FakeHost(), { maxLines: 4 });
      buf.append(["a", "b", "c"]);
      buf.replace(2, ["c"], ["c1", "c2", "c3"]); // -> a,b,c1,c2,c3 -> caps to b,c1,c2,c3
      expect(buf.lines).toEqual(["b", "c1", "c2", "c3"]);
      // "d" is the 4th line of the stream, and the append trims "b" to fit.
      buf.append(["d"]);
      expect(buf.lines).toEqual(["c1", "c2", "c3", "d"]);
      expect(buf.indexOf(3, ["d"])).toBe(3);
    });
  });
});
