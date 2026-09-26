import { describe, expect, it } from "vitest";

import { isPortInUse, openFailureMessage } from "../../src/util/serial-open-error.js";

const localize = (k: string, v?: Record<string, string | number>) =>
  v ? `${k} ${JSON.stringify(v)}` : k;
const inUse = new DOMException("Failed to open serial port.", "NetworkError");

describe("serial-open-error", () => {
  it("reads only a NetworkError as the port being in use", () => {
    expect(isPortInUse(inUse)).toBe(true);
    expect(isPortInUse(new DOMException("already open", "InvalidStateError"))).toBe(
      false
    );
    expect(isPortInUse(new Error("NetworkError"))).toBe(false);
    expect(isPortInUse(null)).toBe(false);
  });

  it("says in use, else the caller's fallback, else the error text", () => {
    expect(openFailureMessage(inUse, localize, "fallback")).toBe(
      'serial.port_in_use {"error":"Failed to open serial port."}'
    );
    expect(openFailureMessage(new Error("boom"), localize, "fallback")).toBe("fallback");
    expect(openFailureMessage(new Error("boom"), localize)).toBe(
      'serial.open_failed {"error":"boom"}'
    );
  });
});
