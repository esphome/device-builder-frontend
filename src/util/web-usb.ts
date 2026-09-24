/**
 * WebUSB availability and the RP2 BOOTSEL device picker. Kept outside the
 * lazy PICOBOOT engine because ``requestDevice()`` must run inside the
 * click's user activation, before any engine chunk is awaited.
 */
export type WebUsbAvailability = "available" | "insecure-context" | "unsupported";

/** Chromium only; Firefox has no WebUSB. Same secure-context caveat as Web Serial. */
export function webUsbAvailability(): WebUsbAvailability {
  if ("usb" in navigator) return "available";
  if (typeof window !== "undefined" && !window.isSecureContext) {
    return "insecure-context";
  }
  return "unsupported";
}

export function isWebUsbSupported(): boolean {
  return webUsbAvailability() === "available";
}

/** The user dismissed the device chooser. */
export function isUsbPickerCancel(err: unknown): boolean {
  return err instanceof DOMException && err.name === "NotFoundError";
}

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
export const RP2040_BOOTSEL_PID = 0x0003;
export const RP2350_BOOTSEL_PID = 0x000f;

export type BootselKind = "rp2040" | "rp2350" | "not-bootsel";

export function classifyUsbDevice(device: USBDevice): BootselKind {
  if (device.vendorId !== RASPBERRY_PI_USB_VID) return "not-bootsel";
  if (device.productId === RP2040_BOOTSEL_PID) return "rp2040";
  if (device.productId === RP2350_BOOTSEL_PID) return "rp2350";
  return "not-bootsel";
}

/**
 * Chooser limited to RP2 bootloaders, so a Pico still running its app never
 * shows up; an RP2350 is listed so it can be refused with a specific message.
 * Returns null when the user dismisses the chooser.
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
    if (isUsbPickerCancel(err)) return null;
    throw err;
  }
}
