/**
 * Writing a UF2 to a Pico over PICOBOOT, from the chooser to the reboot:
 * the sequence both the Device Builder's install dialog and web.esphome.io's
 * setup dialog run. The engine loads on demand.
 */
import type { LocalizeFunc } from "../common/localize.js";
import { getErrorMessage } from "./error-message.js";
import { formatUsbId } from "./flash-log.js";
import type { Uf2Image } from "./uf2.js";
import {
  classifyUsbDevice,
  isUsbAccessDenied,
  isUsbDeviceLost,
  loadPicoboot,
  requestPicobootDevice,
} from "./web-usb.js";

/** Why the write stopped; ``picoFlashFailureCopy`` has the words. */
export type PicoFlashFailure =
  | "rp2350"
  | "not-bootsel"
  | "access-denied"
  | "image"
  | "device-lost"
  | "connect"
  | "flash";

export class PicoFlashError extends Error {
  constructor(
    readonly kind: PicoFlashFailure,
    // Error.cause needs lib ES2022; the field is declared here instead.
    readonly cause?: unknown
  ) {
    super(`Pico flash failed (${kind})`);
    this.name = "PicoFlashError";
  }
}

export interface PicoFlashHooks {
  onProgress: (percent: number) => void;
  /** One line per step, for a details log. */
  onLog?: (line: string) => void;
  signal?: AbortSignal;
  /** The caller moved on: a device opened meanwhile is closed again, unwritten. */
  cancelled?: () => boolean;
  /** The RP2 Boot device is claimed and the write is about to start. */
  onDeviceOpened?: () => void;
}

/**
 * Pick the RP2 Boot device, open it and write ``image``; the Pico reboots
 * into the firmware afterwards. The chooser runs first, inside the click's
 * activation, so an image still downloading may be handed in as a promise;
 * a rejection is reported as the ``image`` kind. False when the chooser was
 * dismissed or the caller moved on. Throws ``PicoFlashError``.
 */
export async function flashPico(
  image: Uf2Image | Promise<Uf2Image>,
  hooks: PicoFlashHooks
): Promise<boolean> {
  const cancelled = hooks.cancelled ?? (() => false);
  let usb: USBDevice | null;
  try {
    usb = await requestPicobootDevice();
  } catch (err) {
    throw new PicoFlashError("connect", err);
  }
  if (!usb || cancelled()) return false;
  // The image is RP2040-only, so an RP2350 here is the wrong board, not an
  // unsupported image.
  const kind = classifyUsbDevice(usb);
  if (kind !== "rp2040")
    throw new PicoFlashError(kind === "rp2350" ? "rp2350" : "not-bootsel");
  const uf2 = await Promise.resolve(image).catch((err: unknown) => {
    throw new PicoFlashError("image", err);
  });
  const { PicobootDevice, flashUf2 } = await loadPicoboot().catch((err: unknown) => {
    throw new PicoFlashError("connect", err);
  });
  const dev = await PicobootDevice.open(usb).catch((err: unknown) => {
    throw new PicoFlashError(isUsbAccessDenied(err) ? "access-denied" : "connect", err);
  });
  // From here the claim must be released on every exit: flashUf2 does it
  // itself, everything before it does not.
  let writing = false;
  try {
    if (cancelled()) {
      await dev.close();
      return false;
    }
    hooks.onLog?.(
      `Claimed the RP2 Boot device (${formatUsbId(usb.vendorId, usb.productId)})`
    );
    hooks.onDeviceOpened?.();
    writing = true;
    await flashUf2(dev, uf2, hooks);
  } catch (err) {
    if (!writing) await dev.close().catch(() => {});
    throw new PicoFlashError(isUsbDeviceLost(err) ? "device-lost" : "flash", err);
  }
  return true;
}

/** The title and detail an install dialog shows for a failed write. */
export function picoFlashFailureCopy(
  err: PicoFlashError,
  localize: LocalizeFunc
): { title: string; detail: string } {
  switch (err.kind) {
    case "rp2350":
      return { title: localize("firmware.rp2_rp2350_device"), detail: "" };
    case "not-bootsel":
      return { title: localize("firmware.rp2_not_bootsel"), detail: "" };
    case "access-denied":
      return {
        title: localize("firmware.rp2_usb_access_denied"),
        detail: getErrorMessage(err.cause),
      };
    case "image":
      return {
        title: localize("firmware.download_failed"),
        detail: getErrorMessage(err.cause),
      };
    case "connect":
      return {
        title: localize("firmware.browser_flash_connect_failed"),
        detail: getErrorMessage(err.cause),
      };
    case "device-lost":
      return {
        title: localize("firmware.rp2_flash_failed"),
        detail: localize("firmware.rp2_device_lost"),
      };
    case "flash":
      return {
        title: localize("firmware.rp2_flash_failed"),
        detail: getErrorMessage(err.cause),
      };
  }
}
