// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { FLASHER_ORIGIN } from "../../../src/common/docs.js";
import {
  type FlasherCallbacks,
  openFlasher,
} from "../../../src/platforms/esp/usb-flasher.js";

function makeCallbacks(): FlasherCallbacks & {
  progress: number[];
  states: Array<{ state: string; detail: string }>;
  lost: number;
  unsupported: number;
  reasons: string[];
  statuses: string[];
} {
  const rec = {
    progress: [] as number[],
    states: [] as Array<{ state: string; detail: string }>,
    statuses: [] as string[],
    lost: 0,
    unsupported: 0,
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
    reasons: [] as string[],
    onUnsupported(reason: string) {
      this.unsupported += 1;
      this.reasons.push(reason);
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

const ESP = { flasher: "esp", erase: true } as const;
const RTL = { flasher: "rtl-ambz2", erase: false } as const;

describe("openFlasher", () => {
  it("returns null when the pop-up is blocked", () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    const teardown = openFlasher(
      new ArrayBuffer(8),
      "f.bin",
      "dev",
      ESP,
      makeCallbacks()
    );
    expect(teardown).toBeNull();
  });

  it("says where the logs are only when the opener knows", () => {
    const fakeWin = { postMessage: vi.fn(), closed: false };
    vi.spyOn(window, "open").mockReturnValue(fakeWin as unknown as Window);
    openFlasher(
      new ArrayBuffer(8),
      "f.uf2",
      "dev",
      { flasher: "bk-uart", erase: false, logs: "flash-port" },
      makeCallbacks()
    );

    emit(fakeWin, { type: "esphome-web-flash:ready", flashers: ["bk-uart"] });

    expect(fakeWin.postMessage.mock.calls[0][0].logs).toBe("flash-port");
  });

  it.each([
    [9600, 9600],
    [undefined, undefined],
  ])("carries the logger baud %s only when the opener knows it", (baud, sent) => {
    const fakeWin = { postMessage: vi.fn(), closed: false };
    vi.spyOn(window, "open").mockReturnValue(fakeWin as unknown as Window);
    openFlasher(
      new ArrayBuffer(8),
      "f.uf2",
      "dev",
      { flasher: "bk-uart", erase: false, logBaudRate: baud },
      makeCallbacks()
    );

    emit(fakeWin, { type: "esphome-web-flash:ready", flashers: ["bk-uart"] });

    expect(fakeWin.postMessage.mock.calls[0][0].logBaudRate).toBe(sent);
  });

  it("opens with nonce+origin, hands off on ready, and reports progress + done", () => {
    const fakeWin = { postMessage: vi.fn(), closed: false };
    const open = vi.spyOn(window, "open").mockReturnValue(fakeWin as unknown as Window);
    const cb = makeCallbacks();
    const teardown = openFlasher(
      new ArrayBuffer(32),
      "firmware.factory.bin",
      "mys3t",
      ESP,
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
    // The default hand-off is esptool's whole-chip factory write.
    expect(msg.flasher).toBe("esp");
    expect(msg.erase).toBe(true);
    expect("logs" in msg).toBe(false);
    expect(targetOrigin).toBe(FLASHER_ORIGIN);
    expect(transfer).toHaveLength(1);

    emit(fakeWin, { type: "esphome-web-flash:progress", pct: 42 });
    expect(cb.progress).toContain(42);

    emit(fakeWin, { type: "esphome-web-flash:state", state: "done" });
    expect(cb.states).toEqual([{ state: "done", detail: "" }]);
  });

  it("declines the hand-off when ready advertises webSerial: false", () => {
    vi.useFakeTimers();
    const fakeWin = { postMessage: vi.fn(), closed: false };
    vi.spyOn(window, "open").mockReturnValue(fakeWin as unknown as Window);
    const cb = makeCallbacks();
    openFlasher(new ArrayBuffer(8), "f.bin", "dev", ESP, cb);
    emit(fakeWin, { type: "esphome-web-flash:ready", version: 1, webSerial: false });
    expect(cb.unsupported).toBe(1);
    // No firmware was transferred to a tab that can never flash it.
    expect(fakeWin.postMessage).not.toHaveBeenCalled();
    // Terminal: the session is finished, so neither the close poll (the tab
    // is left open, closing it is the user's call) nor the watchdog fires
    // onLost.
    fakeWin.closed = true;
    vi.advanceTimersByTime(10 * 60 * 1000 + 1000);
    expect(cb.lost).toBe(0);
    vi.useRealTimers();
  });

  it("hands off when ready omits webSerial (older receiver)", () => {
    const fakeWin = { postMessage: vi.fn(), closed: false };
    vi.spyOn(window, "open").mockReturnValue(fakeWin as unknown as Window);
    const cb = makeCallbacks();
    const teardown = openFlasher(new ArrayBuffer(8), "f.bin", "dev", ESP, cb)!;
    emit(fakeWin, { type: "esphome-web-flash:ready", version: 1 });
    expect(fakeWin.postMessage).toHaveBeenCalledTimes(1);
    expect(cb.unsupported).toBe(0);
    teardown();
  });

  it("surfaces a flasher error with its detail", () => {
    const fakeWin = { postMessage: vi.fn(), closed: false };
    vi.spyOn(window, "open").mockReturnValue(fakeWin as unknown as Window);
    const cb = makeCallbacks();
    // Error is non-terminal (the close poll stays armed); tear down so the test
    // doesn't leak the interval into the worker.
    const teardown = openFlasher(new ArrayBuffer(8), "f.bin", "dev", ESP, cb)!;
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
    const teardown = openFlasher(new ArrayBuffer(8), "f.bin", "dev", ESP, cb)!;
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
    openFlasher(new ArrayBuffer(8), "f.bin", "dev", ESP, cb);
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
    const teardown = openFlasher(new ArrayBuffer(8), "f.bin", "dev", ESP, cb)!;
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
    openFlasher(new ArrayBuffer(8), "f.bin", "dev", ESP, cb);
    vi.advanceTimersByTime(60 * 1000);
    expect(cb.lost).toBe(1);
    vi.useRealTimers();
  });

  it("fires onLost when the flasher window closes", () => {
    vi.useFakeTimers();
    const fakeWin = { postMessage: vi.fn(), closed: false };
    vi.spyOn(window, "open").mockReturnValue(fakeWin as unknown as Window);
    const cb = makeCallbacks();
    openFlasher(new ArrayBuffer(8), "f.bin", "dev", ESP, cb);
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
    openFlasher(new ArrayBuffer(8), "f.bin", "dev", ESP, cb);
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
    openFlasher(new ArrayBuffer(8), "f.bin", "dev", ESP, cb);
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
    const teardown = openFlasher(new ArrayBuffer(8), "f.bin", "dev", ESP, cb)!;
    teardown();
    emit(fakeWin, { type: "esphome-web-flash:ready" });
    expect(fakeWin.postMessage).not.toHaveBeenCalled();
    expect(cb.lost).toBe(0);
  });

  it("hands an RTL8720C UF2 to a receiver that lists its flasher, without erase", () => {
    const fakeWin = { postMessage: vi.fn(), closed: false };
    vi.spyOn(window, "open").mockReturnValue(fakeWin as unknown as Window);
    const cb = makeCallbacks();
    const teardown = openFlasher(new ArrayBuffer(8), "f.uf2", "bw15", RTL, cb)!;
    emit(fakeWin, {
      type: "esphome-web-flash:ready",
      version: 1,
      webSerial: true,
      flashers: ["esp", "rtl-ambz2"],
    });
    expect(fakeWin.postMessage).toHaveBeenCalledTimes(1);
    const [msg] = fakeWin.postMessage.mock.calls[0];
    expect(msg.flasher).toBe("rtl-ambz2");
    expect(msg.erase).toBe(false);
    teardown();
  });

  it.each([
    ["a Pico UF2", "rp2-picoboot"],
    ["an nRF52 DFU package", "nrf-dfu"],
    ["a BK72xx UF2", "bk-uart"],
    ["an LN882H UF2", "ln-uart"],
  ] as const)(
    "hands %s to a receiver that lists its flasher, and to no other",
    (_n, id) => {
      const spec = { flasher: id, erase: false } as const;
      const fakeWin = { postMessage: vi.fn(), closed: false };
      vi.spyOn(window, "open").mockReturnValue(fakeWin as unknown as Window);
      const declined = makeCallbacks();
      openFlasher(new ArrayBuffer(8), "firmware", "dev", spec, declined);
      // A receiver without this engine.
      emit(fakeWin, {
        type: "esphome-web-flash:ready",
        version: 1,
        flashers: ["esp", "rtl-ambz2"],
      });
      expect(declined.reasons).toEqual(["flasher"]);
      expect(fakeWin.postMessage).not.toHaveBeenCalled();

      const teardown = openFlasher(
        new ArrayBuffer(8),
        "firmware",
        "dev",
        spec,
        makeCallbacks()
      )!;
      emit(fakeWin, {
        type: "esphome-web-flash:ready",
        version: 1,
        flashers: ["esp", "rtl-ambz2", id],
      });
      const [msg] = fakeWin.postMessage.mock.calls[0];
      expect(msg.flasher).toBe(id);
      expect(msg.erase).toBe(false);
      teardown();
    }
  );

  it("declines an RTL8720C hand-off to an older receiver that lists no flashers", () => {
    const fakeWin = { postMessage: vi.fn(), closed: false };
    vi.spyOn(window, "open").mockReturnValue(fakeWin as unknown as Window);
    const cb = makeCallbacks();
    openFlasher(new ArrayBuffer(8), "f.uf2", "bw15", RTL, cb);
    // web.esphome.io before this protocol addition: esptool only.
    emit(fakeWin, { type: "esphome-web-flash:ready", version: 1, webSerial: true });
    expect(cb.reasons).toEqual(["flasher"]);
    expect(fakeWin.postMessage).not.toHaveBeenCalled();
  });

  it("declines when the receiver lists flashers but not this one", () => {
    const fakeWin = { postMessage: vi.fn(), closed: false };
    vi.spyOn(window, "open").mockReturnValue(fakeWin as unknown as Window);
    const cb = makeCallbacks();
    openFlasher(new ArrayBuffer(8), "f.uf2", "bw15", RTL, cb);
    emit(fakeWin, { type: "esphome-web-flash:ready", version: 1, flashers: ["esp"] });
    expect(cb.reasons).toEqual(["flasher"]);
  });

  it("passes the receiver's done note on, and nothing from an older receiver's detail", () => {
    const fakeWin = { postMessage: vi.fn(), closed: false };
    vi.spyOn(window, "open").mockReturnValue(fakeWin as unknown as Window);
    const cb = makeCallbacks();
    openFlasher(new ArrayBuffer(8), "f.uf2", "bw15", RTL, cb);
    emit(fakeWin, {
      type: "esphome-web-flash:ready",
      version: 1,
      flashers: ["esp", "rtl-ambz2"],
    });
    emit(fakeWin, {
      type: "esphome-web-flash:state",
      state: "done",
      detail: "close this tab",
      note: "reset the board",
    });
    expect(cb.states).toEqual([{ state: "done", detail: "reset the board" }]);
  });

  it("reads a flashers field that is not a list as esptool only", () => {
    const fakeWin = { postMessage: vi.fn(), closed: false };
    vi.spyOn(window, "open").mockReturnValue(fakeWin as unknown as Window);
    const cb = makeCallbacks();
    openFlasher(new ArrayBuffer(8), "f.uf2", "bw15", RTL, cb);
    emit(fakeWin, { type: "esphome-web-flash:ready", version: 1, flashers: "rtl-ambz2" });
    expect(cb.reasons).toEqual(["flasher"]);
    expect(fakeWin.postMessage).not.toHaveBeenCalled();
  });

  it("names the browser, not the flasher, when Web Serial is what is missing", () => {
    const fakeWin = { postMessage: vi.fn(), closed: false };
    vi.spyOn(window, "open").mockReturnValue(fakeWin as unknown as Window);
    const cb = makeCallbacks();
    openFlasher(new ArrayBuffer(8), "f.bin", "dev", ESP, cb);
    emit(fakeWin, { type: "esphome-web-flash:ready", version: 1, webSerial: false });
    expect(cb.reasons).toEqual(["web-serial"]);
  });
});
