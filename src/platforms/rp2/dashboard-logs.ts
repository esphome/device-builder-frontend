/** The Device Builder's Pico logs policy: no reset line, Reset Device over WebUSB. */
import { notifyError } from "../../util/notify.js";
import type {
  PlatformLogs,
  SerialLogsContext,
  SerialResetHook,
} from "../platform-support.js";
import { picoResetFailureKey, resetPicoForLogs } from "./rp2-logs-reset.js";
import { isRp2CdcPort, isWebUsbSupported } from "./web-usb.js";

/**
 * Reset Device for a Pico logs session, or undefined where the reboot cannot
 * be sent (no WebUSB, so the button stays hidden). The BOOTSEL touch only
 * reaches the Pico over its own CDC, not a UART bridge on its console pins.
 */
export function picoResetHook(ctx: SerialLogsContext): SerialResetHook | undefined {
  if (!isWebUsbSupported()) return undefined;
  return {
    supports: isRp2CdcPort,
    run: async (port, cancelled) => {
      let live: SerialPort | null = null;
      let failure: string | undefined;
      try {
        live = await resetPicoForLogs(port, ctx.baudRate, cancelled);
      } catch (err) {
        console.warn("Pico reset failed", err);
        failure = ctx.localize(picoResetFailureKey(err, "dashboard.logs_reset_failed"));
      }
      if (failure) {
        // A stranded Pico still gets its toast once the session moved on,
        // but a newer session must not be flipped dead.
        if (cancelled()) notifyError(failure);
        else ctx.fail(failure);
      } else if (!live) {
        ctx.failReopen(port, cancelled);
      } else {
        await ctx.attach(live, cancelled);
      }
    },
  };
}

// The Pico's CDC has no reset line to pulse; Reset Device reboots it instead.
export const rp2Logs: PlatformLogs = {
  serial: { pulseResets: false, releasesLinesAfterOpen: false, resetHook: picoResetHook },
};
