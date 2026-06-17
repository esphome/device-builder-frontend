import { describe, expect, it } from "vitest";
import {
  consumePendingSerialSetup,
  markPendingSerialSetup,
} from "../../src/util/pending-serial-setup.js";

// A live SerialPort is opaque here; identity is all the stash cares about.
const fakePort = {} as SerialPort;

describe("pending-serial-setup", () => {
  it("returns null when nothing is pending", () => {
    expect(consumePendingSerialSetup()).toBeNull();
  });

  it("round-trips the stashed port", () => {
    markPendingSerialSetup(fakePort);
    expect(consumePendingSerialSetup()).toEqual({ port: fakePort });
  });

  it("clears after consumption (one-shot)", () => {
    markPendingSerialSetup(fakePort);
    consumePendingSerialSetup();
    // Resumes on the dashboard's next mount only, not every mount after.
    expect(consumePendingSerialSetup()).toBeNull();
  });

  it("distinguishes a stashed null port from nothing pending", () => {
    // The toast can capture port === null; the wrapper keeps that
    // distinct from the no-pending null so the wizard still opens.
    markPendingSerialSetup(null);
    expect(consumePendingSerialSetup()).toEqual({ port: null });
  });
});
