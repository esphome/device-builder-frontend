// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isUsbAccessDenied,
  isUsbDeviceLost,
  isWebUsbSupported,
  RASPBERRY_PI_USB_VID,
  requestPicobootDevice,
} from "../../src/util/web-usb.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const origUsb = Object.getOwnPropertyDescriptor(navigator, "usb");
const origSecure = Object.getOwnPropertyDescriptor(window, "isSecureContext");

function setUsb(usb: object | null, secure = true) {
  if (usb) Object.defineProperty(navigator, "usb", { configurable: true, value: usb });
  else if ("usb" in navigator) delete (navigator as any).usb;
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: secure });
}

afterEach(() => {
  if (origUsb) Object.defineProperty(navigator, "usb", origUsb);
  else if ("usb" in navigator) delete (navigator as any).usb;
  if (origSecure) Object.defineProperty(window, "isSecureContext", origSecure);
});

describe("isWebUsbSupported", () => {
  it("keys off navigator.usb", () => {
    setUsb({});
    expect(isWebUsbSupported()).toBe(true);
    setUsb(null);
    expect(isWebUsbSupported()).toBe(false);
  });
});

describe("requestPicobootDevice", () => {
  it("filters the chooser to RP2 bootloaders and returns the pick", async () => {
    const device = { vendorId: RASPBERRY_PI_USB_VID, productId: 3 };
    const requestDevice = vi.fn(async () => device);
    setUsb({ requestDevice });
    await expect(requestPicobootDevice()).resolves.toBe(device);
    expect(requestDevice).toHaveBeenCalledWith({
      filters: [
        { vendorId: RASPBERRY_PI_USB_VID, productId: 0x0003 },
        { vendorId: RASPBERRY_PI_USB_VID, productId: 0x000f },
      ],
    });
  });

  it("returns null when the chooser is dismissed", async () => {
    setUsb({
      requestDevice: vi.fn(async () => {
        throw new DOMException("No device selected.", "NotFoundError");
      }),
    });
    await expect(requestPicobootDevice()).resolves.toBeNull();
  });

  it("rethrows other failures", async () => {
    setUsb({
      requestDevice: vi.fn(async () => {
        throw new DOMException("Access denied.", "SecurityError");
      }),
    });
    await expect(requestPicobootDevice()).rejects.toMatchObject({
      name: "SecurityError",
    });
  });
});

describe("error classifiers", () => {
  it("recognises a lost device", () => {
    expect(isUsbDeviceLost(new DOMException("x", "NetworkError"))).toBe(true);
    expect(isUsbDeviceLost(new DOMException("x", "InvalidStateError"))).toBe(true);
    expect(isUsbDeviceLost(new DOMException("x", "SecurityError"))).toBe(false);
  });

  it("recognises a refused open", () => {
    expect(isUsbAccessDenied(new DOMException("x", "SecurityError"))).toBe(true);
    expect(isUsbAccessDenied(new DOMException("Access denied.", "NetworkError"))).toBe(
      true
    );
    expect(
      isUsbAccessDenied(new DOMException("Device unavailable.", "NetworkError"))
    ).toBe(false);
  });
});
