/**
 * @vitest-environment happy-dom
 *
 * connectToPort gives the esptool handshake, and the release after a failed
 * one, a deadline each: a device that never answers cannot hold the UI until
 * it is unplugged (#1858).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  main: (): Promise<string> => new Promise(() => {}),
  disconnect: (): Promise<void> => Promise.resolve(),
}));
const loaderOptions = vi.hoisted(() => ({ last: undefined as unknown }));

vi.mock("esptool-js", () => {
  class Transport {
    constructor(
      public device: unknown,
      public trace: boolean
    ) {}

    async connect() {}

    disconnect() {
      return state.disconnect();
    }
  }
  class ESPLoader {
    chip = null;

    constructor(public options: unknown) {
      loaderOptions.last = options;
    }

    info() {}

    debug() {}

    async runStub() {
      return this.chip;
    }

    main() {
      return state.main();
    }
  }
  return { ESPLoader, Transport };
});

import {
  connectToPort,
  disconnect,
  resetAndDisconnect,
} from "../../../src/platforms/esp/esptool.js";
import { SerialConnectTimeoutError } from "../../../src/util/serial-open-error.js";

const port = { close: vi.fn(async () => {}) } as unknown as SerialPort;
// Past the handshake deadline and the release deadline, whatever they are.
const LONG_ENOUGH_MS = 120_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(port.close).mockClear();
  state.main = () => new Promise(() => {});
  state.disconnect = () => Promise.resolve();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("connectToPort deadline", () => {
  it("gives up on a handshake nobody answers and releases the port", async () => {
    const disconnected = vi.fn(async () => {});
    state.disconnect = disconnected;
    const result = connectToPort(port);
    const assertion = expect(result).rejects.toBeInstanceOf(SerialConnectTimeoutError);
    await vi.advanceTimersByTimeAsync(LONG_ENOUGH_MS);
    await assertion;
    expect(disconnected).toHaveBeenCalledOnce();
  });

  it("still fails with the timeout when the release itself hangs", async () => {
    // A write that never returned keeps the writer locked, so the stream
    // teardown waits forever; the caller must not.
    state.disconnect = () => new Promise(() => {});
    const result = connectToPort(port);
    const assertion = expect(result).rejects.toBeInstanceOf(SerialConnectTimeoutError);
    await vi.advanceTimersByTimeAsync(LONG_ENOUGH_MS);
    await assertion;
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("Could not release the port")
    );
  });

  it("stops the abandoned handshake's late lines from reaching the log", async () => {
    const logs: string[] = [];
    const result = connectToPort(port, (l) => logs.push(l));
    const assertion = expect(result).rejects.toBeInstanceOf(SerialConnectTimeoutError);
    await vi.advanceTimersByTimeAsync(LONG_ENOUGH_MS);
    await assertion;
    const { terminal } = loaderOptions.last as {
      terminal: { writeLine: (l: string) => void };
    };
    terminal.writeLine("Connecting... (late)");
    expect(logs[logs.length - 1]).toMatch(/^Error: /);
  });

  it("leaves a handshake that answers in time alone", async () => {
    state.main = async () => "ESP32";
    await expect(connectToPort(port)).resolves.toMatchObject({ chipName: "ESP32" });
  });
});

describe("disconnect", () => {
  it("closes the port directly when the transport's disconnect rejects", async () => {
    state.disconnect = () => Promise.reject(new Error("stream gone"));
    const transport = { disconnect: () => state.disconnect(), device: port };
    await disconnect(transport as never);
    expect(port.close).toHaveBeenCalledOnce();
  });

  it("gives up on a release that hangs, with a warning, instead of waiting", async () => {
    state.disconnect = () => new Promise(() => {});
    const transport = { disconnect: () => state.disconnect(), device: port };
    const done = disconnect(transport as never);
    await vi.advanceTimersByTimeAsync(LONG_ENOUGH_MS);
    await done;
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("Could not release the port")
    );
  });

  it("never closes the port for a release that fails after it gave up", async () => {
    // By then the port may be a later attempt's; the fallback close stays out.
    let failLate: (err: Error) => void = () => {};
    state.disconnect = () => new Promise((_, reject) => (failLate = reject));
    const transport = { disconnect: () => state.disconnect(), device: port };
    const done = disconnect(transport as never);
    await vi.advanceTimersByTimeAsync(LONG_ENOUGH_MS);
    await done;
    failLate(new Error("stream gone, eventually"));
    await vi.advanceTimersByTimeAsync(0);
    expect(port.close).not.toHaveBeenCalled();
  });

  it("leaves no timer behind after a release that settles in time", async () => {
    const transport = { disconnect: () => state.disconnect(), device: port };
    await disconnect(transport as never);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("resetAndDisconnect", () => {
  // The reset's own setSignals are stubbed out; the release afterwards is
  // what this pins.
  const transportFor = (port: SerialPort) => ({
    disconnect: () => state.disconnect(),
    device: port,
    setDTR: async () => {},
    setRTS: async () => {},
    setSignals: async () => {},
  });
  const loader = {} as never;

  it("closes the port directly when the disconnect after the reset rejects", async () => {
    state.disconnect = () => Promise.reject(new Error("stream gone"));
    const usbPort = {
      ...port,
      getInfo: () => ({ usbVendorId: 0x1a86, usbProductId: 0x7523 }),
      setSignals: async () => {},
    } as unknown as SerialPort;
    const done = resetAndDisconnect(loader, transportFor(usbPort) as never, usbPort);
    await vi.advanceTimersByTimeAsync(LONG_ENOUGH_MS); // the reset's own pulse sleeps
    await done;
    expect(usbPort.close).toHaveBeenCalledOnce();
  });

  it("resolves past the release deadline when the disconnect hangs", async () => {
    state.disconnect = () => new Promise(() => {});
    const usbPort = {
      ...port,
      getInfo: () => ({ usbVendorId: 0x1a86, usbProductId: 0x7523 }),
      setSignals: async () => {},
    } as unknown as SerialPort;
    const done = resetAndDisconnect(loader, transportFor(usbPort) as never, usbPort);
    await vi.advanceTimersByTimeAsync(LONG_ENOUGH_MS);
    await done;
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("Could not release the port")
    );
  });
});
