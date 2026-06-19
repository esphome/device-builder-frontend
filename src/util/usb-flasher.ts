import toast from "sonner-js";
import type { ESPHomeAPI } from "../api/index.js";
import type { ConfiguredDevice } from "../api/types/devices.js";
import { JobStatus } from "../api/types/firmware-jobs.js";
import { FLASHER_ORIGIN, FLASHER_URL } from "../common/docs.js";
import type { LocalizeFunc } from "../common/localize.js";
import { getErrorMessage } from "./error-message.js";
import { isEsptoolPlatform } from "./esptool-platform.js";

// Outbound message types, mirroring flasher/src/protocol.ts in the
// device-builder repo. The nonce travels one way only (dashboard -> flasher).
const MSG_READY = "esphome-web-flash:ready";
const MSG_FIRMWARE = "esphome-web-flash:firmware";
const MSG_STATE = "esphome-web-flash:state";
const MSG_PROGRESS = "esphome-web-flash:progress";

// Stop listening to the flasher tab after this much silence, so a tab that's
// closed / crashed / navigated away mid-flash (no terminal state) can't leave
// the message listener and its captured firmware buffer alive for the page.
const FLASH_WATCHDOG_MS = 15 * 60 * 1000;

// Compile and resolve when the job completes; reject with the backend error text.
// The follow-job stream auto-detaches on the terminal result (see ESPHomeAPI).
async function compileAndWait(api: ESPHomeAPI, configuration: string): Promise<void> {
  const job = await api.firmwareCompile(configuration);
  return new Promise((resolve, reject) => {
    api.firmwareFollowJob(job.job_id, {
      onResult: (data) => {
        const result = data as unknown as { status: string; error?: string | null };
        if (result.status === JobStatus.COMPLETED) resolve();
        // Keep the real failure mode visible when the backend sends no text.
        else reject(new Error(result.error || `compile ${result.status}`));
      },
      onError: (error) => reject(new Error(error)),
    });
  });
}

/**
 * Flash a device over USB by handing its factory image to the external
 * secure-context flasher (FLASHER_URL) via postMessage.
 *
 * Used where the dashboard itself can't run Web Serial (the HA add-on is plain
 * http). The flasher tab does the actual flash; the bytes go tab-to-tab and
 * never touch a server.
 */
export async function flashViaUsb(
  api: ESPHomeAPI,
  localize: LocalizeFunc,
  device: ConfiguredDevice
): Promise<void> {
  if (!isEsptoolPlatform(device.target_platform)) {
    toast.error(localize("dashboard.flash_usb_unsupported"), { richColors: true });
    return;
  }

  // Open the flasher synchronously so the user gesture isn't lost to the popup
  // blocker; firmware is compiled/fetched afterwards and handed off on "ready".
  const nonce = crypto.randomUUID();
  const url = `${FLASHER_URL}#nonce=${encodeURIComponent(
    nonce
  )}&origin=${encodeURIComponent(location.origin)}`;
  const win = window.open(url, "_blank");
  if (!win) {
    toast.error(localize("dashboard.flash_usb_popup_blocked"), { richColors: true });
    return;
  }

  const toastId = `flash-usb-${nonce}`;
  toast.loading(localize("dashboard.flash_usb_preparing"), { id: toastId });

  // Single teardown path: aborting the controller removes the message listener,
  // and the close-poll + watchdog bound its lifetime if no terminal state ever
  // arrives (tab closed / crashed / went silent).
  const controller = new AbortController();
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let closePoll: ReturnType<typeof setInterval> | undefined;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    controller.abort();
    if (watchdog !== undefined) clearTimeout(watchdog);
    if (closePoll !== undefined) clearInterval(closePoll);
  };
  // Surface a failure (instead of a forever-spinning loading toast) when the
  // flasher tab closes or goes silent before reporting a terminal state.
  const abandon = () => {
    if (finished) return;
    toast.error(localize("dashboard.flash_usb_window_closed"), {
      id: toastId,
      richColors: true,
    });
    finish();
  };

  let ready = false;
  let firmware: { name: string; data: ArrayBuffer } | null = null;
  let handedOff = false;

  const handOff = () => {
    if (handedOff || !ready || !firmware) return;
    handedOff = true;
    win.postMessage(
      {
        type: MSG_FIRMWARE,
        nonce,
        name: firmware.name,
        erase: true,
        parts: [{ address: 0, data: firmware.data }],
      },
      FLASHER_ORIGIN,
      [firmware.data]
    );
    // Bytes are transferred (detached); drop the reference so the listener
    // closure that lives on for state/progress doesn't pin the wrapper.
    firmware = null;
    toast.loading(localize("dashboard.flash_usb_handoff"), { id: toastId });
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
      ready = true;
      handOff();
    } else if (data.type === MSG_PROGRESS) {
      toast.loading(localize("dashboard.flash_usb_flashing", { pct: data.pct ?? 0 }), {
        id: toastId,
      });
    } else if (data.type === MSG_STATE) {
      if (data.state === "done") {
        toast.success(localize("dashboard.flash_usb_done"), {
          id: toastId,
          richColors: true,
        });
        finish();
      } else if (data.state === "error") {
        toast.error(data.detail || localize("dashboard.flash_usb_failed"), {
          id: toastId,
          richColors: true,
        });
        finish();
      } else if (data.detail) {
        toast.loading(data.detail, { id: toastId });
      }
    }
  };

  window.addEventListener("message", onMessage, { signal: controller.signal });
  closePoll = setInterval(() => {
    if (win.closed) abandon();
  }, 1000);
  watchdog = setTimeout(abandon, FLASH_WATCHDOG_MS);

  try {
    let binaries = await api.firmwareGetBinaries(device.configuration);
    if (binaries.length === 0) {
      toast.loading(localize("dashboard.flash_usb_compiling"), { id: toastId });
      await compileAndWait(api, device.configuration);
      binaries = await api.firmwareGetBinaries(device.configuration);
    }
    const factory =
      binaries.find((b) => b.file === "firmware.factory.bin") ??
      binaries.find((b) => b.file === "firmware.bin") ??
      binaries.find((b) => b.file.includes("factory"));
    if (!factory) {
      toast.error(localize("dashboard.flash_usb_no_binary"), {
        id: toastId,
        richColors: true,
      });
      finish();
      return;
    }
    toast.loading(localize("dashboard.flash_usb_downloading"), { id: toastId });
    const data = await api.firmwareDownloadBytes(device.configuration, factory.file);
    firmware = { name: factory.file, data };
    handOff();
  } catch (err) {
    toast.error(getErrorMessage(err) || localize("dashboard.flash_usb_failed"), {
      id: toastId,
      richColors: true,
    });
    finish();
  }
}
