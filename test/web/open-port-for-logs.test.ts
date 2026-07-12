// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/dialog/dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/spinner/spinner.js", () => ({}));
vi.mock("sonner-js", () => ({ default: { error: vi.fn() } }));

import toast from "sonner-js";
import { openPortForLogs } from "../../src/web/logs/esphome-web-logs-dialog.js";

const localize = (k: string) => k;

function makePort(
  open: () => Promise<void>,
  readable: { locked: boolean } | null = null
) {
  return { open: vi.fn(open), close: vi.fn(async () => {}), readable };
}

afterEach(() => vi.clearAllMocks());

describe("openPortForLogs", () => {
  it("opens a closed port and returns true", async () => {
    const port = makePort(async () => {});
    await expect(openPortForLogs(port as unknown as SerialPort, localize)).resolves.toBe(
      true
    );
    expect(port.open).toHaveBeenCalledWith({ baudRate: 115200, bufferSize: 8192 });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("treats an already-open port with an unlocked reader as ready", async () => {
    const port = makePort(
      async () => {
        throw new DOMException("already open", "InvalidStateError");
      },
      { locked: false }
    );
    await expect(openPortForLogs(port as unknown as SerialPort, localize)).resolves.toBe(
      true
    );
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("bails with a toast when the already-open port's reader is locked", async () => {
    const port = makePort(
      async () => {
        throw new DOMException("already open", "InvalidStateError");
      },
      { locked: true }
    );
    await expect(openPortForLogs(port as unknown as SerialPort, localize)).resolves.toBe(
      false
    );
    expect(toast.error).toHaveBeenCalledOnce();
  });

  it("toasts and returns false on any other open error", async () => {
    const port = makePort(async () => {
      throw new Error("device gone");
    });
    await expect(openPortForLogs(port as unknown as SerialPort, localize)).resolves.toBe(
      false
    );
    expect(toast.error).toHaveBeenCalledOnce();
  });
});
