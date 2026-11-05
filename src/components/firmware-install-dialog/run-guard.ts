import type { ESPHomeFirmwareInstallDialog } from "../firmware-install-dialog.js";

/**
 * Whether the dialog is still open on the install run it is on now. A
 * dismissal only flips the open flag; a reopen, for the same device or
 * another, starts the next run.
 */
export function runGuard(host: ESPHomeFirmwareInstallDialog): () => boolean {
  const run = host._installRun;
  return () => host._installRun === run && host._open;
}
