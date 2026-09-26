// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The SDK module only needs to register the custom element as a side effect;
// in happy-dom ``createElement`` yields a generic element we drive directly.
vi.mock("improv-wifi-serial-sdk/dist/serial-provision-dialog", () => ({}));
vi.mock("sonner-js", () => ({ default: { error: vi.fn() } }));
// Post-reset reopen goes through openLiveSerialPort (re-enumeration retry
// loop); stub it so the suite can hand back the cached or a fresh handle.
const { openLiveSerialPort } = vi.hoisted(() => ({ openLiveSerialPort: vi.fn() }));
vi.mock("../../src/util/serial-reacquire.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  openLiveSerialPort,
}));

import toast from "sonner-js";

import { markOpenFailure } from "../../src/util/serial-open-error.js";
import {
  isImprovInProgress,
  openImprovDialog,
} from "../../src/web/improv/open-improv-dialog.js";

const localize: (k: string, v?: Record<string, string | number>) => string = (k) => k;
const flush = () => new Promise((r) => setTimeout(r, 0));

function makePort(info: SerialPortInfo = {}): {
  close: ReturnType<typeof vi.fn>;
  setSignals: ReturnType<typeof vi.fn>;
  getInfo: () => SerialPortInfo;
  readable: unknown;
  writable: unknown;
} {
  return {
    close: vi.fn(async () => {}),
    setSignals: vi.fn(async () => {}),
    getInfo: () => info,
    readable: null,
    writable: null,
  };
}

function dialogEls(): NodeListOf<HTMLElement> {
  return document.querySelectorAll("improv-wifi-serial-provision-dialog");
}
function dialogEl(): HTMLElement | null {
  return document.querySelector("improv-wifi-serial-provision-dialog");
}

type LiveOptions = { onOpened?: (port: SerialPort) => void };

beforeEach(() => {
  // Default: the cached handle reopens in place (UART bridge / Firefox).
  openLiveSerialPort.mockImplementation(async (port: SerialPort, opts: LiveOptions) => {
    opts.onOpened?.(port);
    return port;
  });
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("openImprovDialog", () => {
  it("reopens the port at 115200 with an 8k buffer and mounts the SDK dialog", async () => {
    const port = makePort();
    const promise = openImprovDialog(port as unknown as SerialPort, localize);
    await flush();

    expect(openLiveSerialPort).toHaveBeenCalledWith(
      port,
      expect.objectContaining({ baudRate: 115200, bufferSize: 8192 })
    );
    // DTR/RTS released so a bridge board's auto-reset circuit can't hold EN low.
    expect(port.setSignals).toHaveBeenCalledWith({
      dataTerminalReady: false,
      requestToSend: false,
    });
    const el = dialogEl();
    expect(el).toBeTruthy();
    expect((el as unknown as { port: unknown }).port).toBe(port);

    el!.dispatchEvent(
      new CustomEvent("closed", { detail: { improv: true, provisioned: true } })
    );
    await expect(promise).resolves.toEqual({ improv: true, provisioned: true });
  });

  it("counts as in progress from the first await, before any dialog mounts", async () => {
    let opened!: (port: SerialPort | null) => void;
    openLiveSerialPort.mockImplementationOnce(
      () => new Promise<SerialPort | null>((resolve) => (opened = resolve))
    );
    const port = makePort();
    const promise = openImprovDialog(port as unknown as SerialPort, localize);
    expect(isImprovInProgress()).toBe(true);
    opened(null);
    await promise;
    expect(isImprovInProgress()).toBe(false);
  });

  it.each([
    [
      "a Pico's own port, even unasked (the ESP card after a dismissed flow switch)",
      { usbVendorId: 0x2e8a, usbProductId: 0xf00a },
      {},
    ],
    [
      "any port when asked",
      { usbVendorId: 0x303a, usbProductId: 0x1001 },
      { keepLines: true },
    ],
  ])(
    "keeps DTR asserted on %s (a Pico's CDC only transmits while DTR is up)",
    async (_name, info, options) => {
      const port = makePort(info);
      const promise = openImprovDialog(port as unknown as SerialPort, localize, options);
      await flush();
      expect(port.setSignals).not.toHaveBeenCalled();
      expect(dialogEl()).toBeTruthy();
      dialogEl()!.dispatchEvent(new CustomEvent("closed", { detail: {} }));
      await promise;
    }
  );

  it("swallows the SDK's late state-request rejection while a dialog is up, and nothing else", async () => {
    const port = makePort();
    const promise = openImprovDialog(port as unknown as SerialPort, localize);
    await flush();
    const rejection = (reason: unknown) => {
      const ev = new Event("unhandledrejection", { cancelable: true }) as Event & {
        reason: unknown;
      };
      ev.reason = reason;
      window.dispatchEvent(ev);
      return ev.defaultPrevented;
    };
    // Stands in for the dev server's error overlay, a plain window listener.
    const overlay = vi.fn();
    window.addEventListener("unhandledrejection", overlay);
    try {
      expect(rejection(new Error("Error fetching current state: TIMEOUT"))).toBe(true);
      expect(overlay).not.toHaveBeenCalled();
      expect(rejection(new Error("something else"))).toBe(false);
      expect(overlay).toHaveBeenCalledOnce();
    } finally {
      window.removeEventListener("unhandledrejection", overlay);
    }
    // A device error on the same request is real news, not the SDK's race.
    expect(rejection(new Error("Error fetching current state: BAD_HOSTNAME"))).toBe(
      false
    );
    // The SDK's late rejection can land up to its RPC timeout after the close;
    // the guard stays for that long and no longer.
    dialogEl()!.dispatchEvent(new CustomEvent("closed", { detail: {} }));
    await promise;
    expect(rejection(new Error("Error fetching current state: TIMEOUT"))).toBe(true);
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + 30_000);
      expect(rejection(new Error("Error fetching current state: TIMEOUT"))).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports improv-detected-but-not-provisioned and closes the port", async () => {
    const port = makePort();
    const promise = openImprovDialog(port as unknown as SerialPort, localize);
    await flush();

    dialogEl()!.dispatchEvent(
      new CustomEvent("closed", { detail: { improv: true, provisioned: false } })
    );
    await expect(promise).resolves.toEqual({ improv: true, provisioned: false });
    expect(port.close).toHaveBeenCalledOnce();
  });

  it("resolves only once the port closed, retrying while the SDK's reader holds it (#1839)", async () => {
    const close = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new TypeError("stream is locked"))
      .mockImplementationOnce(async () => {
        port.readable = null;
      });
    const port = { ...makePort(), close };
    const promise = openImprovDialog(port as unknown as SerialPort, localize);
    await flush();
    port.readable = { locked: true };
    dialogEl()!.dispatchEvent(new CustomEvent("closed", { detail: {} }));
    await promise;
    expect(close).toHaveBeenCalledTimes(2);
  });

  it("resolves at the deadline when the close is still pending (a wedged driver)", async () => {
    const close = vi.fn(() => new Promise<void>(() => {}));
    const port = { ...makePort(), close };
    const promise = openImprovDialog(port as unknown as SerialPort, localize);
    await flush();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.useFakeTimers();
    try {
      let settled = false;
      void promise.then(() => (settled = true));
      dialogEl()!.dispatchEvent(new CustomEvent("closed", { detail: {} }));
      // It waits for the close right up to the deadline, then moves on.
      await vi.advanceTimersByTimeAsync(999);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await expect(promise).resolves.toEqual({ improv: false, provisioned: false });
      expect(close).toHaveBeenCalledOnce();
      expect(warn).toHaveBeenCalledWith("[Improv] Port close still pending; moving on");
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });

  it("keeps retrying the close while only the SDK's writer still holds the port", async () => {
    const close = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new TypeError("stream is locked"))
      .mockImplementationOnce(async () => {
        port.writable = null;
      });
    const port = { ...makePort(), close };
    const promise = openImprovDialog(port as unknown as SerialPort, localize);
    await flush();
    port.writable = { locked: true };
    dialogEl()!.dispatchEvent(new CustomEvent("closed", { detail: {} }));
    await promise;
    expect(close).toHaveBeenCalledTimes(2);
  });

  it("coerces a missing detail to a false/false result", async () => {
    const port = makePort();
    const promise = openImprovDialog(port as unknown as SerialPort, localize);
    await flush();

    dialogEl()!.dispatchEvent(new CustomEvent("closed", { detail: {} }));
    await expect(promise).resolves.toEqual({ improv: false, provisioned: false });
  });

  it("does NOT remove the dialog itself (the SDK owns removal)", async () => {
    const port = makePort();
    const promise = openImprovDialog(port as unknown as SerialPort, localize);
    await flush();

    dialogEl()!.dispatchEvent(new CustomEvent("closed", { detail: {} }));
    await promise;
    // Wrapper left the element in place; the real SDK's _handleClose removes it
    // after firing "closed" — a second removal here would crash removeChild.
    expect(dialogEl()).toBeTruthy();
  });

  it("hands the SDK the fresh handle a re-enumerated device came back as (#1678)", async () => {
    const stale = makePort();
    const fresh = makePort();
    openLiveSerialPort.mockImplementation(async (_p: SerialPort, opts: LiveOptions) => {
      opts.onOpened?.(fresh as unknown as SerialPort);
      return fresh;
    });
    const onPortReplaced = vi.fn();
    const promise = openImprovDialog(stale as unknown as SerialPort, localize, {
      onPortReplaced,
    });
    await flush();

    expect((dialogEl() as unknown as { port: unknown }).port).toBe(fresh);
    // The card is told so its other actions drop the dead pre-reset handle.
    expect(onPortReplaced).toHaveBeenCalledWith(fresh);
    dialogEl()!.dispatchEvent(
      new CustomEvent("closed", { detail: { improv: true, provisioned: true } })
    );
    await expect(promise).resolves.toEqual({ improv: true, provisioned: true });
    // The handle we opened is the one we release.
    expect(fresh.close).toHaveBeenCalledOnce();
    expect(stale.close).not.toHaveBeenCalled();
  });

  it("guards the swapped-in handle against a second mount too", async () => {
    const stale = makePort();
    const fresh = makePort();
    openLiveSerialPort.mockImplementation(async (_p: SerialPort, opts: LiveOptions) => {
      opts.onOpened?.(fresh as unknown as SerialPort);
      return fresh;
    });
    const first = openImprovDialog(stale as unknown as SerialPort, localize);
    await flush();
    // After port-replaced adoption the card's next click passes the fresh handle.
    const second = await openImprovDialog(fresh as unknown as SerialPort, localize);
    expect(second).toEqual({ improv: false, provisioned: false });
    expect(dialogEls().length).toBe(1);

    dialogEl()!.dispatchEvent(new CustomEvent("closed", { detail: {} }));
    await first;
  });

  it("uses the full re-enumeration budget only after a reset", async () => {
    const port = makePort();
    let p = openImprovDialog(port as unknown as SerialPort, localize, {
      afterReset: true,
    });
    await flush();
    expect(openLiveSerialPort.mock.calls[0][1]).not.toHaveProperty("timeoutMs");
    dialogEl()!.dispatchEvent(new CustomEvent("closed", { detail: {} }));
    await p;
    dialogEls().forEach((el) => el.remove());

    p = openImprovDialog(port as unknown as SerialPort, localize);
    await flush();
    expect(openLiveSerialPort.mock.calls[1][1]).toMatchObject({ timeoutMs: 2000 });
    dialogEl()!.dispatchEvent(new CustomEvent("closed", { detail: {} }));
    await p;
  });

  it("reopens instead of reusing an open handle whose device is gone", async () => {
    const dead = makePort();
    dead.readable = { locked: false };
    (dead as unknown as { connected: boolean }).connected = false;
    const fresh = makePort();
    openLiveSerialPort.mockImplementation(async (_p: SerialPort, opts: LiveOptions) => {
      opts.onOpened?.(fresh as unknown as SerialPort);
      return fresh;
    });
    const promise = openImprovDialog(dead as unknown as SerialPort, localize);
    await flush();

    expect(openLiveSerialPort).toHaveBeenCalledOnce();
    // Released first so the reopen loop can reopen the same handle if it
    // comes back, rather than handing the SDK the errored stream.
    expect(dead.close).toHaveBeenCalledOnce();
    expect((dialogEl() as unknown as { port: unknown }).port).toBe(fresh);
    dialogEl()!.dispatchEvent(new CustomEvent("closed", { detail: {} }));
    await promise;
  });

  it("does not report a replacement when the cached handle reopened in place", async () => {
    const port = makePort();
    const onPortReplaced = vi.fn();
    const promise = openImprovDialog(port as unknown as SerialPort, localize, {
      onPortReplaced,
    });
    await flush();
    expect(onPortReplaced).not.toHaveBeenCalled();
    dialogEl()!.dispatchEvent(new CustomEvent("closed", { detail: {} }));
    await promise;
  });

  it("bails with the busy toast when the live handle's writer is held", async () => {
    const stale = makePort();
    const theirs = makePort();
    theirs.readable = { locked: false };
    theirs.writable = { locked: true };
    openLiveSerialPort.mockResolvedValue(theirs as unknown as SerialPort);
    const result = await openImprovDialog(stale as unknown as SerialPort, localize);

    expect(result).toEqual({ improv: false, provisioned: false });
    expect(toast.error).toHaveBeenCalledWith("web.improv.port_busy");
    expect(dialogEl()).toBeNull();
    expect(theirs.close).not.toHaveBeenCalled();
  });

  it("does not close a handle openLiveSerialPort found already open", async () => {
    const stale = makePort();
    const theirs = makePort();
    theirs.readable = { locked: false };
    // Found open (no onOpened): it belongs to whoever opened it.
    openLiveSerialPort.mockResolvedValue(theirs as unknown as SerialPort);
    const promise = openImprovDialog(stale as unknown as SerialPort, localize);
    await flush();

    expect(theirs.setSignals).not.toHaveBeenCalled();
    dialogEl()!.dispatchEvent(new CustomEvent("closed", { detail: {} }));
    await promise;
    expect(theirs.close).not.toHaveBeenCalled();
  });

  it("proceeds when the port is already open, and does NOT close a port it didn't open", async () => {
    const port = makePort();
    port.readable = { locked: false };
    const promise = openImprovDialog(port as unknown as SerialPort, localize);
    await flush();

    expect(openLiveSerialPort).not.toHaveBeenCalled();
    expect(dialogEl()).toBeTruthy();
    dialogEl()!.dispatchEvent(
      new CustomEvent("closed", { detail: { improv: true, provisioned: false } })
    );
    await promise;
    // We didn't open it, so we must not close it.
    expect(port.close).not.toHaveBeenCalled();
  });

  it("ignores a second call on the same port while one is in flight", async () => {
    const port = makePort();
    const first = openImprovDialog(port as unknown as SerialPort, localize);
    const second = await openImprovDialog(port as unknown as SerialPort, localize);
    await flush();

    // The guard bailed the second call without mounting a second dialog.
    expect(second).toEqual({ improv: false, provisioned: false });
    expect(dialogEls().length).toBe(1);

    dialogEl()!.dispatchEvent(new CustomEvent("closed", { detail: {} }));
    await first;

    // The real SDK removes its dialog on close; our mock doesn't, so clear the
    // leftover element before checking that the port is free for a new session.
    dialogEls().forEach((el) => el.remove());
    const third = openImprovDialog(port as unknown as SerialPort, localize);
    await flush();
    expect(dialogEls().length).toBe(1);
    dialogEl()!.dispatchEvent(new CustomEvent("closed", { detail: {} }));
    await third;
  });

  it("bails with a toast when the already-open port's streams are locked", async () => {
    const port = makePort();
    port.readable = { locked: true };
    const result = await openImprovDialog(port as unknown as SerialPort, localize);

    expect(result).toEqual({ improv: false, provisioned: false });
    expect(toast.error).toHaveBeenCalledOnce();
    expect(dialogEl()).toBeNull();
  });

  it("toasts and returns a false result without mounting when no live port opens", async () => {
    const port = makePort();
    openLiveSerialPort.mockResolvedValue(null);
    const result = await openImprovDialog(port as unknown as SerialPort, localize);

    expect(result).toEqual({ improv: false, provisioned: false });
    expect(toast.error).toHaveBeenCalledOnce();
    expect(dialogEl()).toBeNull();
  });

  // A manual open says why it failed; right after a reset a NetworkError can
  // be the board re-enumerating, so that keeps the restart advice.
  it.each([
    [false, "NetworkError", "serial.port_in_use"],
    [false, "SecurityError", "serial.open_failed"],
    [true, "NetworkError", "web.improv.open_failed"],
  ])("afterReset %s with a %s open toasts %s", async (afterReset, name, key) => {
    const err = new DOMException("Failed to open serial port.", name);
    markOpenFailure(err);
    openLiveSerialPort.mockImplementation(
      async (_p: SerialPort, opts: { onFailed?: (err: unknown) => void }) => {
        opts.onFailed?.(err);
        return null;
      }
    );
    await openImprovDialog(makePort() as unknown as SerialPort, localize, { afterReset });
    expect(toast.error).toHaveBeenCalledWith(key);
  });
});
