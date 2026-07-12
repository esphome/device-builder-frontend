import type { FlashPart } from "../util/esphome-web-firmware.js";

/**
 * ESP32/ESP8266 firmware (and the bootloader a factory image starts with)
 * carries this magic byte at the bootloader offset.
 */
export const ESP_IMAGE_MAGIC = 0xe9;

/**
 * Reject anything that isn't an ESP image before the chip is erased. The magic
 * sits at byte 0 for ESP8266 and native-USB ESP32 parts (S3/C3/C6, bootloader
 * at 0x0); the classic ESP32 / ESP32-S2 merged factory image pads 0x0–0xFFF
 * with 0xFF and puts the bootloader (magic) at 0x1000; ESP32-P4 / C5 / C61 pad
 * further and put the bootloader at 0x2000. Returns ``true`` when the payload
 * looks like ESP firmware, ``false`` otherwise.
 */
export function validateEspImage(files: FlashPart[]): boolean {
  const boot = files.find((f) => f.address === 0);
  if (!boot) return false;
  return (
    boot.data[0] === ESP_IMAGE_MAGIC ||
    (boot.data.length > 0x1000 && boot.data[0x1000] === ESP_IMAGE_MAGIC) ||
    (boot.data.length > 0x2000 && boot.data[0x2000] === ESP_IMAGE_MAGIC)
  );
}
