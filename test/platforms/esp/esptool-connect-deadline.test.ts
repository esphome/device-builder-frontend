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

vi.mock("esptool-js", () => {
  class Transport {
    constructor(
      public port: unknown,
      public trace: boolean
    ) {}

    async connect() {}

    disconnect() {
      return state.disconnect();
    }
  }
  class ESPLoader {
    chip = null;

    constructor(public options: unknown) {}

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
  CONNECT_DEADLINE_MS,
  connectToPort,
  RELEASE_DEADLINE_MS,
} from "../../../src/platforms/esp/esptool.js";
import { SerialConnectTimeoutError } from "../../../src/util/serial-open-error.js";

const port = { close: vi.fn(async () => {}) } as unknown as SerialPort;

beforeEach(() => {
  vi.useFakeTimers();
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
    const disconnect = vi.fn(async () => {});
    state.disconnect = disconnect;
    const result = connectToPort(port);
    const assertion = expect(result).rejects.toBeInstanceOf(SerialConnectTimeoutError);
    await vi.advanceTimersByTimeAsync(CONNECT_DEADLINE_MS);
    await assertion;
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("still fails with the timeout when the release itself hangs", async () => {
    // A stream cancel that never returns (the device is gone, or its driver
    // is stuck) must not keep the caller waiting after the handshake gave up.
    state.disconnect = () => new Promise(() => {});
    const result = connectToPort(port);
    const assertion = expect(result).rejects.toBeInstanceOf(SerialConnectTimeoutError);
    await vi.advanceTimersByTimeAsync(CONNECT_DEADLINE_MS + RELEASE_DEADLINE_MS);
    await assertion;
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("Could not release the port"),
      expect.any(Error)
    );
  });

  it("leaves a handshake that answers in time alone", async () => {
    state.main = async () => "ESP32";
    await expect(connectToPort(port)).resolves.toMatchObject({ chipName: "ESP32" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps its own error for a handshake that fails in time", async () => {
    state.main = () => Promise.reject(new Error("Failed to connect with the device"));
    await expect(connectToPort(port)).rejects.toThrow(
      "Failed to connect with the device"
    );
  });
});
