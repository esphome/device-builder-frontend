/**
 * In-browser Pico install for web.esphome.io: the manifest's RP2040 UF2
 * written over PICOBOOT (WebUSB) to a Pico sitting in BOOTSEL, the way the
 * Device Builder's rp2-uf2-install flow does. The engine loads on demand.
 */
import { parseUf2Image, UF2_FAMILY_RP2040 } from "../../util/uf2.js";
import type { Uf2Image } from "../../util/uf2.js";
import {
  classifyUsbDevice,
  isUsbAccessDenied,
  isUsbDeviceLost,
  loadPicoboot,
  requestPicobootDevice,
} from "../../util/web-usb.js";
import {
  ESPHOME_WEB_FIRMWARE_PREFIX,
  fetchEsphomeWebManifest,
  picoUf2Url,
} from "../util/esphome-web-firmware.js";

/** Why the install stopped, each with its own copy in the dialog. */
export type PicoFlashFailure =
  "rp2350" | "not-bootsel" | "access-denied" | "device-lost" | "connect" | "flash";

export class PicoFlashError extends Error {
  constructor(
    readonly kind: PicoFlashFailure,
    readonly cause?: unknown
  ) {
    super(`Pico flash failed (${kind})`);
    this.name = "PicoFlashError";
  }
}

/** The manifest's Pico W UF2, fetched and parsed. Throws with the reason. */
export async function loadPicoImage(): Promise<Uf2Image> {
  const manifest = await fetchEsphomeWebManifest();
  const url = picoUf2Url(manifest);
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(
      `Downloading ${url.slice(ESPHOME_WEB_FIRMWARE_PREFIX.length + 1)} failed (${resp.status})`
    );
  }
  return parseUf2Image(new Uint8Array(await resp.arrayBuffer()), [UF2_FAMILY_RP2040]);
}

export interface PicoFlashHooks {
  onProgress: (percent: number) => void;
  signal?: AbortSignal;
}

/**
 * Pick the RP2 Boot device (the chooser needs the click's activation, so
 * this runs first) and write ``image`` to it; the Pico reboots into the
 * firmware afterwards. False when the chooser was dismissed. Throws
 * ``PicoFlashError`` for everything the dialog has copy for.
 */
export async function flashPico(
  image: Uf2Image,
  hooks: PicoFlashHooks
): Promise<boolean> {
  let usb: USBDevice | null;
  try {
    usb = await requestPicobootDevice();
  } catch (err) {
    throw new PicoFlashError("connect", err);
  }
  if (!usb) return false;
  // The image is RP2040-only, so an RP2350 here is the wrong board, not an
  // unsupported image.
  const kind = classifyUsbDevice(usb);
  if (kind !== "rp2040")
    throw new PicoFlashError(kind === "rp2350" ? "rp2350" : "not-bootsel");
  const { PicobootDevice, flashUf2 } = await loadPicoboot().catch((err: unknown) => {
    throw new PicoFlashError("connect", err);
  });
  const dev = await PicobootDevice.open(usb).catch((err: unknown) => {
    throw new PicoFlashError(isUsbAccessDenied(err) ? "access-denied" : "connect", err);
  });
  try {
    await flashUf2(dev, image, hooks);
  } catch (err) {
    throw new PicoFlashError(isUsbDeviceLost(err) ? "device-lost" : "flash", err);
  }
  return true;
}
