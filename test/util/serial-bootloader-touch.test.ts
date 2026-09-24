import { describe, expect, it, vi } from "vitest";

import { resetToBootloader } from "../../src/util/serial-bootloader-touch.js";

function fakePort(
  opts: { open?: boolean; closeError?: Error; signalsError?: Error } = {}
) {
  const calls: string[] = [];
  const port = {
    readable: opts.open ? {} : null,
    open: vi.fn(async (o: SerialOptions) => {
      calls.push(`open:${o.baudRate}`);
      port.readable = {};
    }),
    setSignals: vi.fn(async (s: SerialOutputSignals) => {
      calls.push(`signals:dtr=${String(s.dataTerminalReady)}`);
      if (opts.signalsError) throw opts.signalsError;
    }),
    close: vi.fn(async () => {
      calls.push("close");
      port.readable = null;
      if (opts.closeError) throw opts.closeError;
    }),
  };
  return { port: port as unknown as SerialPort, calls };
}

describe("resetToBootloader", () => {
  it("opens at 1200 baud, drops DTR, then closes", async () => {
    const { port, calls } = fakePort();
    await resetToBootloader(port);
    expect(calls).toEqual(["open:1200", "signals:dtr=false", "close"]);
  });

  it("releases a handle left open by an earlier touch before opening", async () => {
    const { port, calls } = fakePort({ open: true });
    await resetToBootloader(port);
    expect(calls).toEqual(["close", "open:1200", "signals:dtr=false", "close"]);
  });

  it("treats the device vanishing mid-close as the reboot it asked for", async () => {
    const { port } = fakePort({
      closeError: new DOMException("The device has been lost.", "NetworkError"),
    });
    await expect(resetToBootloader(port)).resolves.toBeUndefined();
  });

  it("tolerates a device that rebooted on the line coding before DTR dropped", async () => {
    const { port, calls } = fakePort({
      signalsError: new DOMException("The device has been lost.", "NetworkError"),
    });
    await expect(resetToBootloader(port)).resolves.toBeUndefined();
    expect(calls[calls.length - 1]).toBe("close");
  });

  it("still surfaces a failed open", async () => {
    const { port } = fakePort();
    vi.mocked(port.open).mockRejectedValue(
      new DOMException("Failed to open serial port.", "NetworkError")
    );
    await expect(resetToBootloader(port)).rejects.toMatchObject({ name: "NetworkError" });
  });
});
