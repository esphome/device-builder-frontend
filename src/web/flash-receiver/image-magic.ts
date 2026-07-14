import type { FlashPart } from "../util/esphome-web-firmware.js";

/**
 * ESP32/ESP8266 firmware (and the bootloader a factory image starts with)
 * carries this magic byte at the bootloader offset.
 */
export const ESP_IMAGE_MAGIC = 0xe9;

/**
 * Absolute flash offsets the bootloader (which carries the image magic) can
 * start at: 0x0 for ESP8266 and native-USB ESP32 (S3/C3/C6); 0x1000 for classic
 * ESP32 / ESP32-S2; 0x2000 for ESP32-P4 / C5 / C61.
 */
const BOOTLOADER_OFFSETS = [0x0, 0x1000, 0x2000];

/**
 * The byte at absolute flash ``offset`` across the (arbitrarily-addressed)
 * parts, or ``undefined`` when no part covers it.
 */
function byteAtOffset(files: FlashPart[], offset: number): number | undefined {
  for (const f of files) {
    if (offset >= f.address && offset < f.address + f.data.length) {
      return f.data[offset - f.address];
    }
  }
  return undefined;
}

/**
 * Reject anything that isn't an ESP image before the chip is erased. Check the
 * bootloader magic at each possible absolute flash offset across the parts — a
 * merged factory image is a single part at 0x0, but the receiver's protocol
 * also accepts a separate bootloader part at 0x1000 / 0x2000 (with no address-0
 * part). Returns ``true`` when the payload looks like ESP firmware.
 */
export function validateEspImage(files: FlashPart[]): boolean {
  return BOOTLOADER_OFFSETS.some(
    (offset) => byteAtOffset(files, offset) === ESP_IMAGE_MAGIC
  );
}
