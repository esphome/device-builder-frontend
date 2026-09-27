import { describe, expect, it } from "vitest";

import { lapsedPick } from "../_web-serial.js";
import {
  connectFailureDetail,
  markOpenFailure,
  namedConnectFailure,
  openFailureMessage,
  openSerialPort,
  portInUseMessage,
  SerialConnectTimeoutError,
  SerialDeviceLostError,
  SerialOpenTimeoutError,
  SerialPortHeldError,
  SerialWriteStalledError,
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

  it("names a connect that timed out, in seconds, ahead of the fallback", () => {
    const late = new SerialConnectTimeoutError(30_000);
    const TIMED_OUT = 'serial.connect_timed_out {"seconds":30}';
    expect(openFailureMessage(late, localize, "serial.connect_failed")).toBe(TIMED_OUT);
    expect(namedConnectFailure(new Error("no sync"), localize)).toBeUndefined();
  });

  it("names a port that never opened, and one that would not release", () => {
    expect(namedConnectFailure(new SerialOpenTimeoutError(3000), localize)).toBe(
      'serial.open_timed_out {"seconds":3}'
    );
    expect(namedConnectFailure(new SerialPortHeldError(), localize)).toBe(
      "serial.port_held"
    );
  });

  it("names a picker refused after the click ran out, with no browser sentence", () => {
    const err = lapsedPick();
    expect(namedConnectFailure(err, localize)).toBe("serial.picker_needs_click");
    expect(openFailureMessage(err, localize, "web.connect.failed")).toBe(
      "serial.picker_needs_click"
    );
  });

  it("gives the detail under a title: the name, else what the fallback makes of it", () => {
    const refused = lapsedPick();
    expect(connectFailureDetail(refused, localize)).toBe("serial.picker_needs_click");
    expect(connectFailureDetail(new Error("boom"), localize)).toBe("boom");
    expect(connectFailureDetail(new Error("boom"), localize, () => "hinted")).toBe(
      "hinted"
    );
    expect(connectFailureDetail(refused, localize, () => "hinted")).toBe(
      "serial.picker_needs_click"
    );
  });

  it("names a device lost or gone quiet during a write", () => {
    expect(namedConnectFailure(new SerialDeviceLostError(), localize)).toBe(
      "serial.device_lost"
    );
    expect(namedConnectFailure(new SerialWriteStalledError(60_000), localize)).toBe(
      'serial.write_stalled {"seconds":60}'
    );
  });
});
