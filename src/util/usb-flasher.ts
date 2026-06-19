import { FLASHER_ORIGIN, FLASHER_URL } from "../common/docs.js";
import type { ESPHomeFirmwareInstallDialog } from "../components/firmware-install-dialog.js";

// Message types, mirroring flasher/src/protocol.ts in the device-builder repo.
// The nonce travels one way only (dashboard -> flasher).
const MSG_READY = "esphome-web-flash:ready";
const MSG_FIRMWARE = "esphome-web-flash:firmware";
const MSG_STATE = "esphome-web-flash:state";
const MSG_PROGRESS = "esphome-web-flash:progress";

// Give up if the flasher tab never reports "ready" (failed to load / crashed).
const READY_TIMEOUT_MS = 60 * 1000;
// Bound the flash itself (armed at hand-off).
const FLASH_WATCHDOG_MS = 10 * 60 * 1000;

/**
 * Open the external secure-context flasher and hand off the already-built
 * firmware (host._usbFirmware) over postMessage, mirroring the flasher's
 * progress/state back into the install dialog.
 *
 * Must be called from a user gesture (the "Open USB flasher" button) so the
 * popup isn't blocked, and only after the firmware compiled + downloaded — we
 * never open the external site until a working image exists.
 */
export function openFlasherAndHandOff(host: ESPHomeFirmwareInstallDialog): void {
  let bytes: ArrayBuffer | null = host._usbFirmware;
  if (!bytes) return;
  const name = host._usbFirmwareName;

  const nonce = crypto.randomUUID();
  const win = window.open(
    `${FLASHER_URL}#nonce=${encodeURIComponent(nonce)}&origin=${encodeURIComponent(
      location.origin
    )}`,
    "_blank"
  );
  if (!win) {
    host._fail(host._localize("firmware.usb_popup_blocked"));
    return;
  }

  host._step = "flashing";
  host._flashPercent = 0;
  host._statusMessage = host._localize("firmware.usb_flashing");

  const controller = new AbortController();
  let readyTimer: ReturnType<typeof setTimeout> | undefined;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let closePoll: ReturnType<typeof setInterval> | undefined;
  let finished = false;
  let handedOff = false;

  const finish = () => {
    if (finished) return;
    finished = true;
    controller.abort();
    if (readyTimer !== undefined) clearTimeout(readyTimer);
    if (watchdog !== undefined) clearTimeout(watchdog);
    if (closePoll !== undefined) clearInterval(closePoll);
    host._usbFlashTeardown = null;
  };
  // Let the dialog tear this down on close / reuse (see _detachStream).
  host._usbFlashTeardown = finish;
  // The flasher tab closed / crashed / went silent before reporting a result.
  const abandon = () => {
    if (finished) return;
    host._fail(
      host._localize("firmware.usb_failed"),
      host._localize("dashboard.flash_usb_window_closed")
    );
    finish();
  };

  const onMessage = (ev: MessageEvent) => {
    if (ev.origin !== FLASHER_ORIGIN || ev.source !== win) return;
    const data = ev.data as {
      type?: string;
      state?: string;
      detail?: string;
      pct?: number;
    };
    if (!data?.type) return;
    if (data.type === MSG_READY) {
      if (readyTimer !== undefined) clearTimeout(readyTimer);
      if (handedOff || !bytes) return;
      handedOff = true;
      win.postMessage(
        {
          type: MSG_FIRMWARE,
          nonce,
          name,
          erase: true,
          parts: [{ address: 0, data: bytes }],
        },
        FLASHER_ORIGIN,
        [bytes]
      );
      bytes = null; // transferred (detached)
      host._usbFirmware = null;
      watchdog = setTimeout(abandon, FLASH_WATCHDOG_MS);
    } else if (data.type === MSG_PROGRESS) {
      host._flashPercent = data.pct ?? 0;
    } else if (data.type === MSG_STATE) {
      if (data.state === "done") {
        host._step = "done";
        host._statusMessage = host._localize("firmware.usb_done");
        finish();
      } else if (data.state === "error") {
        host._fail(host._localize("firmware.usb_failed"), data.detail || "");
        finish();
      } else if (data.detail) {
        host._statusMessage = data.detail;
      }
    }
  };

  window.addEventListener("message", onMessage, { signal: controller.signal });
  closePoll = setInterval(() => {
    if (win.closed) abandon();
  }, 1000);
  readyTimer = setTimeout(abandon, READY_TIMEOUT_MS);
}
