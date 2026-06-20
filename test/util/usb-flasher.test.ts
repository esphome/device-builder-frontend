// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { FLASHER_ORIGIN } from "../../src/common/docs.js";
import { openFlasher, type FlasherCallbacks } from "../../src/util/usb-flasher.js";

function makeCallbacks(): FlasherCallbacks & {
  progress: number[];
  states: Array<{ state: string; detail: string }>;
  lost: number;
  statuses: string[];
} {
  const rec = {
    progress: [] as number[],
    states: [] as Array<{ state: string; detail: string }>,
    statuses: [] as string[],
    lost: 0,
    onProgress(pct: number) {
      this.progress.push(pct);
    },
    onStatus(detail: string) {
      this.statuses.push(detail);
    },
    onState(state: "done" | "error", detail: string) {
      this.states.push({ state, detail });
    },
    onLost() {
      this.lost += 1;
    },
  };
  return rec;
}

function emit(win: unknown, data: unknown) {
  window.dispatchEvent(
    new MessageEvent("message", {
      data,
      origin: FLASHER_ORIGIN,
      source: win as Window,
    })
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("openFlasher", () => {
  it("returns null when the pop-up is blocked", () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    const teardown = openFlasher(new ArrayBuffer(8), "f.bin", "dev", makeCallbacks());
    expect(teardown).toBeNull();
  });

  it("opens with nonce+origin, hands off on ready, and reports progress + done", () => {
    const fakeWin = { postMessage: vi.fn(), closed: false };
    const open = vi.spyOn(window, "open").mockReturnValue(fakeWin as unknown as Window);
    const cb = makeCallbacks();
    const teardown = openFlasher(
      new ArrayBuffer(32),
      "firmware.factory.bin",
      "mys3t",
      cb
    );
    expect(teardown).toBeTypeOf("function");

    const url = open.mock.calls[0][0] as string;
    expect(url).toContain("#nonce=");
    expect(url).toContain("origin=");

    emit(fakeWin, { type: "esphome-web-flash:ready" });
    expect(fakeWin.postMessage).toHaveBeenCalledTimes(1);
    const [msg, targetOrigin, transfer] = fakeWin.postMessage.mock.calls[0];
    expect(msg.type).toBe("esphome-web-flash:firmware");
    expect(msg.version).toBe(1);
    expect(msg.name).toBe("firmware.factory.bin");
    expect(msg.deviceName).toBe("mys3t");
    expect(msg.parts[0].address).toBe(0);
    expect(targetOrigin).toBe(FLASHER_ORIGIN);
    expect(transfer).toHaveLength(1);

    emit(fakeWin, { type: "esphome-web-flash:progress", pct: 42 });
    expect(cb.progress).toContain(42);

    emit(fakeWin, { type: "esphome-web-flash:state", state: "done" });
    expect(cb.states).toEqual([{ state: "done", detail: "" }]);
  });

  it("surfaces a flasher error with its detail", () => {
    const fakeWin = { postMessage: vi.fn(), closed: false };
    vi.spyOn(window, "open").mockReturnValue(fakeWin as unknown as Window);
    const cb = makeCallbacks();
    // Error is non-terminal (the close poll stays armed); tear down so the test
    // doesn't leak the interval into the worker.
    const teardown = openFlasher(new ArrayBuffer(8), "f.bin", "dev", cb)!;
    emit(fakeWin, { type: "esphome-web-flash:ready" });
    emit(fakeWin, {
      type: "esphome-web-flash:state",
      state: "error",
      detail: "boom",
    });
    expect(cb.states).toEqual([{ state: "error", detail: "boom" }]);
    teardown();
  });

  it("disarms the watchdog on an error so idle-on-error doesn't fire onLost", () => {
    vi.useFakeTimers();
    const fakeWin = { postMessage: vi.fn(), closed: false };
    vi.spyOn(window, "open").mockReturnValue(fakeWin as unknown as Window);
    const cb = makeCallbacks();
    const teardown = openFlasher(new ArrayBuffer(8), "f.bin", "dev", cb)!;
    emit(fakeWin, { type: "esphome-web-flash:ready" });
    emit(fakeWin, { type: "esphome-web-flash:state", state: "error", detail: "boom" });
    // Sit on the error, tab still open, well past the 10-min flash watchdog.
    vi.advanceTimersByTime(10 * 60 * 1000 + 1000);
    expect(cb.lost).toBe(0);
    expect(cb.states).toEqual([{ state: "error", detail: "boom" }]);
    teardown();
    vi.useRealTimers();
  });

  it("keeps listening after an error so an in-tab retry still reports done", () => {
    const fakeWin = { postMessage: vi.fn(), closed: false };
    vi.spyOn(window, "open").mockReturnValue(fakeWin as unknown as Window);
    const cb = makeCallbacks();
    openFlasher(new ArrayBuffer(8), "f.bin", "dev", cb);
    emit(fakeWin, { type: "esphome-web-flash:ready" });
    emit(fakeWin, { type: "esphome-web-flash:state", state: "error", detail: "boom" });
    // User holds BOOT and retries in the same tab; the flasher streams again.
    emit(fakeWin, { type: "esphome-web-flash:progress", pct: 50 });
    emit(fakeWin, { type: "esphome-web-flash:state", state: "done" });
    expect(cb.progress).toContain(50);
    expect(cb.states).toEqual([
      { state: "error", detail: "boom" },
      { state: "done", detail: "" },
    ]);
  });

  it("ignores progress/state frames that arrive before ready", () => {
    const fakeWin = { postMessage: vi.fn(), closed: false };
    vi.spyOn(window, "open").mockReturnValue(fakeWin as unknown as Window);
    const cb = makeCallbacks();
    const teardown = openFlasher(new ArrayBuffer(8), "f.bin", "dev", cb)!;
    // A stray "done" before the firmware hand-off must not flip to success.
    emit(fakeWin, { type: "esphome-web-flash:state", state: "done" });
    emit(fakeWin, { type: "esphome-web-flash:progress", pct: 99 });
    expect(cb.states).toEqual([]);
    expect(cb.progress).toEqual([]);
    expect(fakeWin.postMessage).not.toHaveBeenCalled();
    teardown(); // no terminal state reached; clear armed timers
  });

  it("fires onLost if the flasher never reports ready", () => {
    vi.useFakeTimers();
    const fakeWin = { postMessage: vi.fn(), closed: false };
    vi.spyOn(window, "open").mockReturnValue(fakeWin as unknown as Window);
    const cb = makeCallbacks();
    openFlasher(new ArrayBuffer(8), "f.bin", "dev", cb);
    vi.advanceTimersByTime(60 * 1000);
    expect(cb.lost).toBe(1);
    vi.useRealTimers();
  });

  it("fires onLost when the flasher window closes", () => {
    vi.useFakeTimers();
    const fakeWin = { postMessage: vi.fn(), closed: false };
    vi.spyOn(window, "open").mockReturnValue(fakeWin as unknown as Window);
    const cb = makeCallbacks();
    openFlasher(new ArrayBuffer(8), "f.bin", "dev", cb);
    emit(fakeWin, { type: "esphome-web-flash:ready" });
    fakeWin.closed = true;
    vi.advanceTimersByTime(1000);
    expect(cb.lost).toBe(1);
    vi.useRealTimers();
  });

  it("does not fire onLost when the tab closes after an error", () => {
    vi.useFakeTimers();
    const fakeWin = { postMessage: vi.fn(), closed: false };
    vi.spyOn(window, "open").mockReturnValue(fakeWin as unknown as Window);
    const cb = makeCallbacks();
    openFlasher(new ArrayBuffer(8), "f.bin", "dev", cb);
    emit(fakeWin, { type: "esphome-web-flash:ready" });
    emit(fakeWin, { type: "esphome-web-flash:state", state: "error", detail: "boom" });
    // User gives up on the failed flash and closes the tab.
    fakeWin.closed = true;
    vi.advanceTimersByTime(1000);
    expect(cb.lost).toBe(0);
    expect(cb.states).toEqual([{ state: "error", detail: "boom" }]);
    vi.useRealTimers();
  });

  it("fires onLost when the tab closes mid-retry after an error", () => {
    vi.useFakeTimers();
    const fakeWin = { postMessage: vi.fn(), closed: false };
    vi.spyOn(window, "open").mockReturnValue(fakeWin as unknown as Window);
    const cb = makeCallbacks();
    openFlasher(new ArrayBuffer(8), "f.bin", "dev", cb);
    emit(fakeWin, { type: "esphome-web-flash:ready" });
    emit(fakeWin, { type: "esphome-web-flash:state", state: "error", detail: "boom" });
    // In-tab retry restarts (progress clears the errored guard), then the tab is
    // closed mid-flash: that's a genuine lost contact.
    emit(fakeWin, { type: "esphome-web-flash:progress", pct: 30 });
    fakeWin.closed = true;
    vi.advanceTimersByTime(1000);
    expect(cb.lost).toBe(1);
    vi.useRealTimers();
  });

  it("teardown stops listening without firing onLost", () => {
    const fakeWin = { postMessage: vi.fn(), closed: false };
    vi.spyOn(window, "open").mockReturnValue(fakeWin as unknown as Window);
    const cb = makeCallbacks();
    const teardown = openFlasher(new ArrayBuffer(8), "f.bin", "dev", cb)!;
    teardown();
    emit(fakeWin, { type: "esphome-web-flash:ready" });
    expect(fakeWin.postMessage).not.toHaveBeenCalled();
    expect(cb.lost).toBe(0);
  });
});
