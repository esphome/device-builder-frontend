import { afterEach, describe, expect, it, vi } from "vitest";

import { pickerRefused, withUserActivation, withWebSerial } from "../_web-serial.js";
import {
  PickerActivationError,
  pickerFailure,
} from "../../src/util/picker-activation.js";
import { PortNotAcceptedError, requestSerialPort } from "../../src/util/web-serial.js";

let restore: Array<() => void> = [];
afterEach(() => {
  restore.forEach((r) => r());
  restore = [];
});

const activation = (active: boolean | null) => restore.push(withUserActivation(active));
const picker = (requestPort: () => Promise<unknown>) =>
  restore.push(withWebSerial(true, { requestPort: vi.fn(requestPort) }));

describe("pickerFailure", () => {
  it("names a picker refused after the click ran out, and keeps the cause", () => {
    activation(false);
    const refused = pickerRefused();
    const named = pickerFailure(refused);
    expect(named).toBeInstanceOf(PickerActivationError);
    expect((named as PickerActivationError).cause).toBe(refused);
  });

  it("leaves a refusal alone while the click still counts: the feature is blocked", () => {
    activation(true);
    const refused = pickerRefused();
    expect(pickerFailure(refused)).toBe(refused);
  });

  it("leaves a refusal alone where the browser does not report the activation", () => {
    activation(null);
    const refused = pickerRefused();
    expect(pickerFailure(refused)).toBe(refused);
  });

  it("leaves any other failure alone", () => {
    activation(false);
    const err = new DOMException("gone", "NetworkError");
    expect(pickerFailure(err)).toBe(err);
    expect(pickerFailure("boom")).toBe("boom");
  });
});

describe("requestSerialPort", () => {
  it("throws the named error for a picker refused after the click ran out", async () => {
    activation(false);
    picker(async () => {
      throw pickerRefused();
    });
    await expect(requestSerialPort()).rejects.toBeInstanceOf(PickerActivationError);
  });

  it("still returns null for a dismissed picker and the port for a pick", async () => {
    activation(false);
    picker(async () => {
      throw new DOMException("No port selected by the user.", "NotFoundError");
    });
    await expect(requestSerialPort()).resolves.toBeNull();

    const port = {};
    picker(async () => port);
    await expect(requestSerialPort()).resolves.toBe(port);
  });

  it("still turns away a port the caller cannot use", async () => {
    picker(async () => ({}));
    await expect(requestSerialPort(undefined, () => false)).rejects.toBeInstanceOf(
      PortNotAcceptedError
    );
  });
});
