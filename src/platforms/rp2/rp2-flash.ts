/**
 * Writing a UF2 to a Pico over PICOBOOT, from the chooser to the reboot:
 * the sequence both the Device Builder's install dialog and web.esphome.io's
 * setup dialog run. The engine loads on demand.
 */
import type { LocalizeFunc } from "../../common/localize.js";
import { getErrorMessage } from "../../util/error-message.js";
import { formatUsbId } from "../../util/flash-log.js";
import { connectFailureDetail } from "../../util/serial-open-error.js";
import type { Uf2Image } from "../../util/uf2.js";
import { type PicoChip, picoChipOf } from "./pico-uf2.js";
import {
  classifyUsbDevice,
  isUsbAccessDenied,
  isUsbDeviceLost,
  loadPicoboot,
  requestPicobootDevice,
} from "./web-usb.js";

// Part numbers, the same in every language.
const CHIP_NAME: Record<PicoChip, string> = { rp2040: "RP2040", rp2350: "RP2350" };

/** Why the write stopped; ``picoFlashFailureCopy`` has the words. */
export type PicoFlashFailure =
  | "wrong-board"
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

/** The board that was picked is not the chip the image was built for. */
export class PicoWrongBoardError extends PicoFlashError {
  constructor(
    readonly board: PicoChip,
    readonly image: PicoChip
  ) {
    super("wrong-board");
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
 * a rejection is reported as the ``image`` kind. An image for the other chip
 * is refused unwritten. False when the chooser was dismissed or the caller
 * moved on. Throws ``PicoFlashError``.
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
  const board = classifyUsbDevice(usb);
  if (board === "not-bootsel") throw new PicoFlashError("not-bootsel");
  const uf2 = await Promise.resolve(image).catch((err: unknown) => {
    throw new PicoFlashError("image", err);
  });
  const chip = picoChipOf(uf2);
  if (chip !== board) throw new PicoWrongBoardError(board, chip);
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

/**
 * The title and detail an install dialog shows for a failed write; anything
 * ``flashPico`` did not name reads as a failed flash.
 */
export function picoFlashFailureCopy(
  err: unknown,
  localize: LocalizeFunc
): { title: string; detail: string } {
  if (!(err instanceof PicoFlashError)) {
    return { title: localize("firmware.rp2_flash_failed"), detail: getErrorMessage(err) };
  }
  if (err instanceof PicoWrongBoardError) {
    return {
      title: localize("firmware.rp2_wrong_board", {
        board: CHIP_NAME[err.board],
        image: CHIP_NAME[err.image],
      }),
      detail: "",
    };
  }
  switch (err.kind) {
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
        detail: connectFailureDetail(err.cause, localize),
      };
    case "device-lost":
      return {
        title: localize("firmware.rp2_flash_failed"),
        detail: localize("firmware.rp2_device_lost"),
      };
    // The pair is named above; the bare kind has nothing more to say.
    case "wrong-board":
    case "flash":
      return {
        title: localize("firmware.rp2_flash_failed"),
        detail: getErrorMessage(err.cause),
      };
  }
}
