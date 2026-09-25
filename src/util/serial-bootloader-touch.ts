/**
 * The 1200-baud touch: open the CDC port at 1200 baud, drop DTR, close.
 * Native-USB firmware reboots into its bootloader on that (the Adafruit
 * nRF52 core on the line coding alone, arduino-pico once DTR also drops),
 * re-enumerating as a different USB device.
 */
const isPortLost = (err: unknown): boolean =>
  err instanceof DOMException &&
  (err.name === "NetworkError" || err.name === "InvalidStateError");

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
  } catch (err) {
    // Already gone: it rebooted on the line coding alone (nRF52). Anything
    // else means DTR never dropped, so an RP2 would not have reset.
    if (!isPortLost(err)) throw err;
  }
  try {
    await port.close();
  } catch (err) {
    // The device vanished mid-close; that is the reboot we asked for.
    if (!isPortLost(err)) throw err;
  }
}
