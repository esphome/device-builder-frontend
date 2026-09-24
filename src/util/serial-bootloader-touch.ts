/**
 * The 1200-baud touch: open the CDC port at 1200 baud, drop DTR, close.
 * Native-USB firmware reboots into its bootloader on that (the Adafruit
 * nRF52 core on the line coding alone, arduino-pico once DTR also drops),
 * re-enumerating as a different USB device.
 */
export async function resetToBootloader(port: SerialPort): Promise<void> {
  // A handle left open by an earlier touch whose close raced the reboot
  // would make open() throw "already open"; release it first.
  if (port.readable) await port.close().catch(() => {});
  await port.open({ baudRate: 1200 });
  try {
    // Drop DTR ourselves rather than through close(): the device reboots the
    // instant it drops, and a close() racing that can leave the OS handle
    // held until the page is reloaded.
    await port.setSignals({ dataTerminalReady: false, requestToSend: false });
  } catch {
    // Already rebooting on the line coding alone (nRF52).
  }
  try {
    await port.close();
  } catch {
    // The device vanished mid-close; that is the reboot we asked for.
  }
}
