import { describe, expect, it } from "vitest";

import {
  markOpenFailure,
  openFailureMessage,
  openSerialPort,
  portInUseMessage,
} from "../../src/util/serial-open-error.js";

const localize = (k: string, v?: Record<string, string | number>) =>
  v ? `${k} ${JSON.stringify(v)}` : k;
const inUse = new DOMException("Failed to open serial port.", "NetworkError");
markOpenFailure(inUse);
const IN_USE = 'serial.port_in_use {"error":"Failed to open serial port."}';

describe("serial-open-error", () => {
  it("reads only a NetworkError as the port being in use", () => {
    expect(portInUseMessage(inUse, localize)).toBe(IN_USE);
    for (const err of [
      new DOMException("already open", "InvalidStateError"),
      new Error("NetworkError"),
      // A device dropping mid-read throws NetworkError too; only open()'s counts.
      new DOMException("The device has been lost.", "NetworkError"),
      null,
    ]) {
      expect(portInUseMessage(err, localize)).toBeUndefined();
    }
  });

  it("says in use, else the fallback key with the error", () => {
    expect(openFailureMessage(inUse, localize, "fallback")).toBe(IN_USE);
    expect(openFailureMessage(new Error("boom"), localize, "fallback")).toBe(
      'fallback {"error":"boom"}'
    );
    expect(openFailureMessage(new Error("boom"), localize)).toBe(
      'serial.open_failed {"error":"boom"}'
    );
  });

  it("marks what openSerialPort's open() rejects with", async () => {
    const err = new DOMException("Failed to open serial port.", "NetworkError");
    const port = { open: async () => Promise.reject(err) } as unknown as SerialPort;
    await expect(openSerialPort(port, { baudRate: 115200 })).rejects.toBe(err);
    expect(portInUseMessage(err, localize)).toBe(IN_USE);
  });
});
