/**
 * The 1200-baud touch: open the CDC port at 1200 baud and close it again.
 * Native-USB firmware (arduino-pico, the Adafruit nRF52 core) reboots into
 * its bootloader on that line-coding change, re-enumerating as a different
 * USB device.
 */
export async function resetToBootloader(port: SerialPort): Promise<void> {
  await port.open({ baudRate: 1200 });
  await port.close();
}
