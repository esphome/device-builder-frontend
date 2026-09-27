/** The flash receiver's esptool engine: today's ESP hand-off, unchanged in behaviour. */
import { ESP_SERIAL_LOGS } from "../../../platforms/esp/serial-logs.js";
import type { ReceiverEngine } from "../../flash-receiver/receiver-engine.js";
import { validateEspImage } from "./image-magic.js";
import { runFlash, webFlashMessages } from "./run-flash.js";

export const espReceiverEngine: ReceiverEngine = {
  logs: ESP_SERIAL_LOGS,
  async validate(parts, localize) {
    return validateEspImage(parts) ? null : localize("web.flash.invalid_image");
  },
  async run(port, parts, erase, hooks) {
    return runFlash(
      port,
      {
        erase,
        filesCallback: async () => parts,
        messages: webFlashMessages(hooks.localize),
      },
      {
        onStep: (step) => {
          if (step === "connecting") {
            hooks.onState("connecting", hooks.localize("firmware.status_connecting"));
          } else if (step === "erasing") {
            hooks.onState("installing", hooks.localize("web.flash.erasing"));
          } else if (step === "flashing") {
            hooks.onState("installing", hooks.localize("dashboard.status_installing"));
          }
        },
        onProgress: hooks.onProgress,
        onLog: hooks.onLog,
        onError: (message) => hooks.onState("error", message),
      }
    );
  },
};
