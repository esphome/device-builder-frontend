/**
 * The ESPHome Web flash engine, shared by the upload and adoptable install
 * dialogs. Reuses ``web-serial.ts`` end to end: connect + detect the chip,
 * ask the plan which binaries to flash, optionally erase, write each part with
 * aggregate progress, then hard-reset so the new firmware boots.
 *
 * Pure orchestration over callbacks — no DOM — so a dialog just renders the
 * reported state.
 */
import {
  connectToPort,
  disconnect,
  flashFirmware,
  resetAndDisconnect,
  type DetectedChip,
} from "../../util/web-serial.js";
import type { FlashPart } from "../util/esphome-web-firmware.js";

export type FlashStep =
  "connecting" | "preparing" | "erasing" | "flashing" | "done" | "error";

/**
 * Localized copy for the engine's own failure states. The engine is DOM- and
 * i18n-free, so callers pass the strings; when omitted it falls back to the raw
 * error / an English default.
 */
export interface FlashMessages {
  /**
   * Shown when the initial connect / chip handshake fails — the actionable
   * "hold the BOOT button" hint (a bare S2/S3/C3 module needs it).
   */
  connectFailed?: string;
  /** Shown when the plan yields no parts to write. */
  noFirmware?: string;
}

export interface FlashPlan {
  /** Whether to erase the whole flash before writing (upload path). */
  erase?: boolean;
  /**
   * Given the detected chip family (esptool ``chip.CHIP_NAME``, e.g.
   * ``ESP32-C3``), return the parts to flash. Throws to abort with a message.
   */
  filesCallback: (chipFamily: string) => Promise<FlashPart[]>;
  /** Localized failure copy (see :class:`FlashMessages`). */
  messages?: FlashMessages;
}

export interface FlashHooks {
  onStep: (step: FlashStep) => void;
  onProgress: (percent: number) => void;
  onLog: (line: string) => void;
  onError: (message: string) => void;
}

/** Best-effort teardown of a half-open connection after a failure. */
async function safeDisconnect(detected: DetectedChip): Promise<void> {
  try {
    await disconnect(detected.transport);
  } catch {
    // Port may already be closed / gone; nothing more to do.
  }
}

/**
 * Run a flash plan against an authorized (closed) port. Returns ``true`` on a
 * completed flash + reset, ``false`` on cancel or failure (the hooks carry the
 * detail). Never throws — the caller renders from the reported state.
 */
export async function runFlash(
  port: SerialPort,
  plan: FlashPlan,
  hooks: FlashHooks
): Promise<boolean> {
  hooks.onStep("connecting");
  let detected: DetectedChip;
  try {
    detected = await connectToPort(port, hooks.onLog);
  } catch (err) {
    // The port is already authorized (connectToPort never shows a picker), so a
    // failure here is the chip handshake — surface the hold-BOOT hint if the
    // caller gave us one, and keep the raw error in the console for debugging.
    console.error(err);
    hooks.onStep("error");
    hooks.onError(
      plan.messages?.connectFailed ?? (err instanceof Error ? err.message : String(err))
    );
    return false;
  }

  const chipFamily = detected.loader.chip?.CHIP_NAME ?? detected.chipName;

  let parts: FlashPart[];
  try {
    hooks.onStep("preparing");
    parts = await plan.filesCallback(chipFamily);
    if (parts.length === 0) {
      throw new Error(plan.messages?.noFirmware ?? "No firmware to flash.");
    }
  } catch (err) {
    hooks.onStep("error");
    hooks.onError(err instanceof Error ? err.message : String(err));
    await safeDisconnect(detected);
    return false;
  }

  try {
    if (plan.erase) {
      hooks.onStep("erasing");
      await detected.loader.eraseFlash();
    }
    hooks.onStep("flashing");
    const total = parts.reduce((sum, p) => sum + p.data.length, 0);
    let flashed = 0;
    for (const part of parts) {
      await flashFirmware(detected.loader, part.data, part.address, (p) => {
        const current = flashed + (p.percent / 100) * part.data.length;
        hooks.onProgress(total === 0 ? 100 : Math.round((current / total) * 100));
      });
      flashed += part.data.length;
    }
    hooks.onProgress(100);
    hooks.onStep("done");
  } catch (err) {
    hooks.onStep("error");
    hooks.onError(err instanceof Error ? err.message : String(err));
    await safeDisconnect(detected);
    return false;
  }

  // The firmware is already written and committed at this point. The final
  // reset is best-effort: native-USB chips (C6/H2/P4 → UsbJtagSerialReset)
  // drop and re-enumerate mid-reset, so resetAndDisconnect can throw even
  // though the write succeeded. Swallow it — a reset hiccup must not turn a
  // successful flash into a reported failure (which would also skip the
  // adoptable flow's Wi-Fi hand-off).
  try {
    await resetAndDisconnect(detected.loader, detected.transport, detected.port);
  } catch {
    // Device already rebooting into the new firmware; nothing to recover.
  }
  return true;
}
