/**
 * Close a port whose owner is gone (a flow switch unmounted the card while
 * its open was pending). Nothing is left to show a failure to, but a port
 * that stays open would make the next flow's open fail for no visible
 * reason, so the failure is at least logged.
 */
export async function releaseOrphanedPort(port: SerialPort): Promise<void> {
  try {
    await port.close();
  } catch (err) {
    console.warn("Could not release an orphaned serial port", err);
  }
}
