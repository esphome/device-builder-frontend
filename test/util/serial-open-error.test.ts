import { describe, expect, it } from "vitest";

import {
  openFailureMessage,
  portInUseMessage,
} from "../../src/util/serial-open-error.js";

const localize = (k: string, v?: Record<string, string | number>) =>
  v ? `${k} ${JSON.stringify(v)}` : k;
const inUse = new DOMException("Failed to open serial port.", "NetworkError");
const IN_USE = 'serial.port_in_use {"error":"Failed to open serial port."}';

describe("serial-open-error", () => {
  it("reads only a NetworkError as the port being in use", () => {
    expect(portInUseMessage(inUse, localize)).toBe(IN_USE);
    for (const err of [
      new DOMException("already open", "InvalidStateError"),
      new Error("NetworkError"),
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
});
