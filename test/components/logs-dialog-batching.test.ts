/**
 * @vitest-environment happy-dom
 *
 * The logs dialog coalesces per-line appends into one render per animation
 * frame and caps the retained buffer, so a verbose / garbage-flooding device
 * can't freeze the tab with unbounded per-line re-renders.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ESPHomeLogsDialog } from "../../src/components/logs-dialog.js";

let rafCb: FrameRequestCallback | null = null;
let raf: ReturnType<typeof vi.fn>;
let caf: ReturnType<typeof vi.fn>;

beforeEach(() => {
  rafCb = null;
  raf = vi.fn((cb: FrameRequestCallback) => {
    rafCb = cb;
    return 1;
  });
  caf = vi.fn();
  vi.stubGlobal("requestAnimationFrame", raf);
  vi.stubGlobal("cancelAnimationFrame", caf);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function fireFrame(): void {
  rafCb?.(0);
}

describe("logs-dialog line batching + cap", () => {
  it("coalesces many enqueues into a single flush per frame", () => {
    const d = new ESPHomeLogsDialog();
    for (let i = 0; i < 100; i++) d._enqueueLine(`line ${i}`);
    expect(d._lines).toHaveLength(0); // nothing visible until the frame fires
    expect(raf).toHaveBeenCalledTimes(1); // one frame for the whole burst
    fireFrame();
    expect(d._lines).toHaveLength(100);
    expect(d._lines[0]).toBe("line 0");
  });

  it("caps the buffer to the newest 5000 lines", () => {
    const d = new ESPHomeLogsDialog();
    const total = 5005;
    for (let i = 0; i < total; i++) d._enqueueLine(String(i));
    fireFrame();
    expect(d._lines).toHaveLength(5000);
    expect(d._lines[0]).toBe("5"); // oldest five dropped
    expect(d._lines[d._lines.length - 1]).toBe(String(total - 1));
  });

  it("bounds the pending buffer when frames never fire (hidden tab)", () => {
    // rAF is captured but never invoked, simulating a backgrounded tab; the
    // pending buffer must not grow without bound during a flood.
    const d = new ESPHomeLogsDialog();
    for (let i = 0; i < 12000; i++) d._enqueueLine(String(i));
    const pending = (d as unknown as { _lineBatch: { _pending: string[] } })._lineBatch
      ._pending;
    expect(d._lines).toHaveLength(0); // nothing flushed without a frame
    expect(pending.length).toBeLessThanOrEqual(10000); // 2 * MAX_LOG_LINES
    expect(pending[pending.length - 1]).toBe("11999"); // newest retained
    fireFrame();
    expect(d._lines).toHaveLength(5000);
    expect(d._lines[d._lines.length - 1]).toBe("11999");
  });

  it("caps the buffer on the recovery-path append (setSerialOpenFailed)", () => {
    const d = new ESPHomeLogsDialog();
    for (let i = 0; i < 5000; i++) d._enqueueLine(String(i));
    fireFrame();
    expect(d._lines).toHaveLength(5000);
    // Drive the reconnect-failure append with the dialog open + a passive
    // session so the guard passes; it must stay capped, not grow to 5001.
    const internal = d as unknown as {
      _open: boolean;
      _session: { kind: string; paused: boolean };
    };
    internal._open = true;
    internal._session = { kind: "reconnecting", paused: false };
    d.setSerialOpenFailed("reopen failed");
    expect(d._lines).toHaveLength(5000);
    expect(d._lines[d._lines.length - 1]).toBe("reopen failed");
  });

  it("resetPendingLines drops the batch and a late frame can't resurrect it", () => {
    const d = new ESPHomeLogsDialog();
    d._enqueueLine("x");
    d._resetPendingLines();
    expect(caf).toHaveBeenCalledWith(1);
    fireFrame();
    expect(d._lines).toHaveLength(0);
  });
});
