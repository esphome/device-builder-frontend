/**
 * WebUSB support check and the RP2 BOOTSEL device picker. Kept outside the
 * lazy PICOBOOT engine because ``requestDevice()`` must run inside the
 * click's user activation, before any engine chunk is awaited.
 */
import { isPortPickerCancel } from "./web-serial.js";

/** Chromium only; Firefox has no WebUSB. */
export const isWebUsbSupported = (): boolean => "usb" in navigator;

/** The PICOBOOT engine, kept in its own chunk. */
export const loadPicoboot = () => import("./rp2-picoboot.js");

/** The device dropped off the bus, or a transfer hit a device that already had. */
export function isUsbDeviceLost(err: unknown): boolean {
  return (
    err instanceof DOMException &&
    (err.name === "NetworkError" || err.name === "InvalidStateError")
  );
}

/** The OS refused the open (Linux without a udev rule, or another driver holds it). */
export function isUsbAccessDenied(err: unknown): boolean {
  return (
    err instanceof DOMException &&
    (err.name === "SecurityError" || /access denied|permission/i.test(err.message))
  );
}

export const RASPBERRY_PI_USB_VID = 0x2e8a;
const RP2040_BOOTSEL_PID = 0x0003;
const RP2350_BOOTSEL_PID = 0x000f;

export function classifyUsbDevice(
  device: USBDevice
): "rp2040" | "rp2350" | "not-bootsel" {
  if (device.vendorId !== RASPBERRY_PI_USB_VID) return "not-bootsel";
  if (device.productId === RP2040_BOOTSEL_PID) return "rp2040";
  if (device.productId === RP2350_BOOTSEL_PID) return "rp2350";
  return "not-bootsel";
}

/** RP2 bootloaders this origin was already granted, so a repeat pick can skip the chooser. */
export async function getPicobootDevices(): Promise<USBDevice[]> {
  const devices = await navigator.usb.getDevices();
  return devices.filter((d) => classifyUsbDevice(d) !== "not-bootsel");
}

/**
 * Chooser limited to RP2 bootloaders, so a Pico still running its app never
 * shows up; an RP2350 is listed so it can be refused with a specific message.
 * Returns null when the user dismisses the chooser (same DOMException as the
 * serial picker).
 */
export async function requestPicobootDevice(): Promise<USBDevice | null> {
  try {
    return await navigator.usb.requestDevice({
      filters: [
        { vendorId: RASPBERRY_PI_USB_VID, productId: RP2040_BOOTSEL_PID },
        { vendorId: RASPBERRY_PI_USB_VID, productId: RP2350_BOOTSEL_PID },
      ],
    });
  } catch (err) {
    if (isPortPickerCancel(err)) return null;
    throw err;
  }
}
