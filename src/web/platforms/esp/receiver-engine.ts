/** The flash receiver's esptool engine: today's ESP hand-off, unchanged in behaviour. */
import { ESP_SERIAL_LOGS } from "../../../platforms/esp/serial-logs.js";
import type { ReceiverEngine } from "../../flash-receiver/receiver-engine.js";
import { serialRun } from "../../flash-receiver/serial-run.js";
import { validateEspImage } from "./image-magic.js";
import { runFlash, webFlashMessages } from "./run-flash.js";

export const espReceiverEngine: ReceiverEngine = {
  logs: ESP_SERIAL_LOGS,
  async prepare(parts, erase, localize) {
    if (!validateEspImage(parts)) return { error: localize("web.flash.invalid_image") };
    const plan = {
      erase,
      filesCallback: async () => parts,
      messages: webFlashMessages(localize),
    };
    return {
      run: serialRun(localize, async (port, hooks) => {
        const ok = await runFlash(port, plan, {
          onStep: (step) => {
            if (step === "connecting") {
              hooks.onState("connecting", localize("firmware.status_connecting"));
            } else if (step === "erasing") {
              hooks.onState("installing", localize("web.flash.erasing"));
            } else if (step === "flashing") {
              hooks.onState("installing", localize("dashboard.status_installing"));
            }
          },
          onProgress: hooks.onProgress,
          onLog: hooks.onLog,
          onError: (message) => hooks.onState("error", message),
        });
        return ok ? { rebooted: true } : null;
      }),
    };
  },
};
