/**
 * @vitest-environment happy-dom
 *
 * The post-install Web Serial logs handoff: reconnect must re-acquire a FRESH
 * port via the picker (the cached esptool handle is dead after a native-USB
 * chip's post-flash re-enumeration), and the reopen-failure message names the
 * port being tried.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/components/dashboard/actions.js", () => ({
  streamSerialToDialog: () => () => {},
}));

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock("sonner-js", () => ({ default: { error: toastError } }));

import { defaultLocalize } from "../../src/common/localize.js";
import {
  attachSerialLogStream,
  formatSerialPortLabel,
  reconnectWebSerialLogs,
} from "../../src/util/post-install-logs.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
function openPort(
  info: SerialPortInfo = { usbVendorId: 0x303a, usbProductId: 0x1001 }
): SerialPort {
  return {
    readable: {} as ReadableStream,
    getInfo: () => info,
    open: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    setSignals: vi.fn().mockResolvedValue(undefined),
  } as unknown as SerialPort;
}

// A closed port whose open() rejects with a non-NetworkError, so the reopen
// retry bails immediately (no fake timers needed).
function deadPort(): SerialPort {
  return {
    readable: null,
    getInfo: () => ({ usbVendorId: 0x303a, usbProductId: 0x1001 }),
    open: vi.fn().mockRejectedValue(new Error("nope")),
    setSignals: vi.fn(),
  } as unknown as SerialPort;
}

function stubDialog() {
  return {
    setSerialStream: vi.fn(),
    setSerialOpenFailed: vi.fn(),
    abortSerialReconnect: vi.fn(),
  };
}

function withRequestPort(impl: () => Promise<SerialPort>): () => void {
  const prev = (navigator as any).serial;
  Object.defineProperty(navigator, "serial", {
    configurable: true,
    value: { requestPort: vi.fn(impl) },
  });
  return () =>
    Object.defineProperty(navigator, "serial", { configurable: true, value: prev });
}

function withGetPorts(impl: () => Promise<SerialPort[]>): () => void {
  const prev = (navigator as any).serial;
  Object.defineProperty(navigator, "serial", {
    configurable: true,
    value: { getPorts: vi.fn(impl) },
  });
  return () =>
    Object.defineProperty(navigator, "serial", { configurable: true, value: prev });
}
/* eslint-enable @typescript-eslint/no-explicit-any */

afterEach(() => {
  vi.clearAllMocks();
});

describe("formatSerialPortLabel", () => {
  it("formats USB vendor:product as 4-digit hex", () => {
    expect(formatSerialPortLabel(openPort())).toBe("USB 303a:1001");
  });

  it("falls back to a neutral label when USB ids are absent", () => {
    expect(formatSerialPortLabel(openPort({}))).toBe("the serial port");
  });
});

describe("reconnectWebSerialLogs", () => {
  it("acquires a fresh port via requestPort and streams it", async () => {
    const restore = withRequestPort(async () => openPort());
    const dialog = stubDialog();
    try {
      await reconnectWebSerialLogs(dialog as never, defaultLocalize);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((navigator as any).serial.requestPort).toHaveBeenCalledTimes(1);
      expect(dialog.setSerialStream).toHaveBeenCalledTimes(1);
      expect(dialog.setSerialOpenFailed).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it("returns to dead without an error when the picker is dismissed", async () => {
    // A dismissed picker rejects with DOMException NotFoundError.
    const restore = withRequestPort(async () => {
      throw new DOMException("dismissed", "NotFoundError");
    });
    const dialog = stubDialog();
    try {
      await reconnectWebSerialLogs(dialog as never, defaultLocalize);
      expect(dialog.abortSerialReconnect).toHaveBeenCalledTimes(1);
      expect(dialog.setSerialOpenFailed).not.toHaveBeenCalled();
      expect(toastError).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it("surfaces a non-cancel requestPort failure instead of swallowing it", async () => {
    const restore = withRequestPort(async () => {
      throw new DOMException("blocked", "SecurityError");
    });
    const dialog = stubDialog();
    try {
      await reconnectWebSerialLogs(dialog as never, defaultLocalize);
      expect(dialog.setSerialOpenFailed).toHaveBeenCalledTimes(1);
      expect(toastError).toHaveBeenCalledTimes(1);
      expect(dialog.abortSerialReconnect).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it("surfaces an open failure when the picked port won't open", async () => {
    const port = openPort();
    (port.open as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("claimed"));
    const restore = withRequestPort(async () => port);
    const dialog = stubDialog();
    try {
      await reconnectWebSerialLogs(dialog as never, defaultLocalize);
      expect(dialog.setSerialOpenFailed).toHaveBeenCalledTimes(1);
      expect(toastError).toHaveBeenCalledTimes(1);
      expect(dialog.abortSerialReconnect).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });
});

describe("attachSerialLogStream reopen", () => {
  it("opens a fresh getPorts() handle when the cached one is dead (Chrome re-enum)", async () => {
    // The cached esptool handle won't reopen, but getPorts() yields a live one
    // for the same device — the auto path must recover with no picker.
    const live = openPort();
    const restore = withGetPorts(async () => [live]);
    const dialog = stubDialog();
    try {
      await attachSerialLogStream(deadPort(), dialog as never, defaultLocalize);
      expect(dialog.setSerialStream).toHaveBeenCalledTimes(1);
      expect(dialog.setSerialStream.mock.calls[0][0]).toBe(live); // streamed the live handle
      expect(dialog.setSerialOpenFailed).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it("names the port in the failure message when nothing opens in the window", async () => {
    vi.useFakeTimers();
    const restore = withGetPorts(async () => []); // device never reappears
    const dialog = stubDialog();
    try {
      const done = attachSerialLogStream(deadPort(), dialog as never, defaultLocalize);
      await vi.advanceTimersByTimeAsync(8100);
      await done;
      expect(dialog.setSerialOpenFailed).toHaveBeenCalledTimes(1);
      const message = dialog.setSerialOpenFailed.mock.calls[0][0] as string;
      expect(message).toContain("USB 303a:1001");
      expect(toastError).toHaveBeenCalledTimes(1);
    } finally {
      restore();
      vi.useRealTimers();
    }
  });
});
