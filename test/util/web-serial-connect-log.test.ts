/**
 * @vitest-environment happy-dom
 *
 * Pins connectToPort's failure logging: esptool-js debug diagnostics replay
 * into the log only when chip detection fails (#2553).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

interface TerminalLike {
  clean: () => void;
  writeLine: (line: string) => void;
  write: (text: string) => void;
}

interface FakeLoaderApi {
  options: { terminal?: TerminalLike; debugLogging?: boolean };
  info: (str: string, withNewline?: boolean) => void;
  debug: (str: string, withNewline?: boolean) => void;
}

const state: {
  main: (loader: FakeLoaderApi) => Promise<string>;
} = {
  main: () => Promise.reject(new Error("unset")),
};

vi.mock("esptool-js", () => {
  class Transport {
    constructor(
      public port: unknown,
      public trace: boolean
    ) {}

    async disconnect() {}
  }
  class ESPLoader {
    chip: { CHIP_NAME: string } | null = null;

    constructor(public options: { terminal?: TerminalLike; debugLogging?: boolean }) {}

    // Mirrors the real terminal routing: info() always writes, debug() only
    // when debugLogging is on (off by default, as in esptool-js).
    info(str: string, withNewline = true) {
      if (withNewline) this.options.terminal?.writeLine(str);
      else this.options.terminal?.write(str);
    }

    debug(str: string) {
      if (this.options.debugLogging) this.options.terminal?.writeLine(`Debug: ${str}`);
    }

    async runStub() {
      return this.chip;
    }

    async main() {
      return state.main(this);
    }
  }
  class UsbJtagSerialReset {}
  return { ESPLoader, Transport, UsbJtagSerialReset };
});

import { connectToPort, UnsupportedChipError } from "../../src/util/web-serial.js";

const fakePort = { close: vi.fn().mockResolvedValue(undefined) } as unknown as SerialPort;

beforeEach(() => {
  state.main = () => Promise.reject(new Error("unset"));
});

describe("connectToPort failure log", () => {
  it("replays the debug tail and the error into the log on failure", async () => {
    state.main = async (loader) => {
      loader.info("Connecting...", false);
      loader.debug("_connect_attempt default_reset");
      loader.debug("Sync err Error: Timeout");
      throw new Error("Failed to connect with the device");
    };
    const logs: string[] = [];
    await expect(connectToPort(fakePort, (line) => logs.push(line))).rejects.toThrow(
      "Failed to connect with the device"
    );
    expect(logs).toContain("Sync err Error: Timeout");
    expect(logs[logs.length - 1]).toBe("Error: Failed to connect with the device");
    // Debug lines are held back until the failure, after live output.
    expect(logs.indexOf("_connect_attempt default_reset")).toBeGreaterThan(
      logs.indexOf("Connecting...")
    );
  });

  it("keeps debug lines out of the log on success", async () => {
    state.main = async (loader) => {
      loader.info("Connecting...", false);
      loader.debug("_connect_attempt default_reset");
      loader.info("Detecting chip type... ESP8266");
      return "ESP8266EX";
    };
    const logs: string[] = [];
    const detected = await connectToPort(fakePort, (line) => logs.push(line));
    expect(detected.chipName).toBe("ESP8266EX");
    expect(logs).toContain("Detecting chip type... ESP8266");
    expect(logs).not.toContain("_connect_attempt default_reset");
    // Capture is removed after main() settles.
    const { ESPLoader } = await import("esptool-js");
    expect(detected.loader.debug).toBe(ESPLoader.prototype.debug);
  });

  it("bounds the replayed debug tail to the most recent lines", async () => {
    state.main = async (loader) => {
      for (let i = 0; i < 200; i++) loader.debug(`line ${i}`);
      throw new Error("Failed to connect with the device");
    };
    const logs: string[] = [];
    await expect(connectToPort(fakePort, (line) => logs.push(line))).rejects.toThrow();
    const debugLines = logs.filter((line) => line.startsWith("line "));
    expect(debugLines).toHaveLength(80);
    expect(debugLines[0]).toBe("line 120");
    expect(debugLines[debugLines.length - 1]).toBe("line 199");
  });

  it("skips the tail replay for an unsupported chip but still logs the error", async () => {
    state.main = async (loader) => {
      loader.debug("healthy handshake line");
      throw new UnsupportedChipError("ESP32-S31");
    };
    const logs: string[] = [];
    await expect(connectToPort(fakePort, (line) => logs.push(line))).rejects.toThrow(
      UnsupportedChipError
    );
    expect(logs).not.toContain("healthy handshake line");
    expect(logs[logs.length - 1]).toMatch(/^Error: ESP32-S31 is not supported/);
  });

  it("delegates captured debug lines to the original debug", async () => {
    state.main = async (loader) => {
      loader.options.debugLogging = true;
      loader.debug("verbose line");
      throw new Error("Failed to connect with the device");
    };
    const logs: string[] = [];
    await expect(connectToPort(fakePort, (line) => logs.push(line))).rejects.toThrow();
    // Live via the original debug() and replayed raw from the tail.
    expect(logs).toContain("Debug: verbose line");
    expect(logs).toContain("verbose line");
  });

  it("leaves debug alone without a log callback", async () => {
    state.main = async () => "ESP8266EX";
    const detected = await connectToPort(fakePort);
    const { ESPLoader } = await import("esptool-js");
    expect(detected.loader.debug).toBe(ESPLoader.prototype.debug);
  });
});
