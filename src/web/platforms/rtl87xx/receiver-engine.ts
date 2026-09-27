/**
 * The flash receiver's RTL8720C engine: the LibreTiny UF2 handed over as one
 * part is parsed here, and the AmebaZ2 ROM downloader writes it, the same
 * engine the in-app flow and the web RTL dialog use. The RTL8710B is not this
 * engine: its ROM speaks another protocol and gets its own id and module.
 */
import { LIBRETINY_AMBZ2_GUIDE_URL } from "../../../common/docs.js";
import {
  loadAmbz2Engine,
  loadAmbz2Image,
  RTL87XX_SERIAL_LOGS,
  runAmbz2,
} from "../../../platforms/rtl87xx/index.js";
import type { ReceiverEngine } from "../../flash-receiver/receiver-engine.js";

export const rtlAmbz2ReceiverEngine: ReceiverEngine = {
  logs: RTL87XX_SERIAL_LOGS,
  async prepare(parts, _erase, localize) {
    // One part, the whole UF2, at address 0; anything else is not this hand-off.
    const parsed =
      parts.length === 1 && parts[0].address === 0
        ? await loadAmbz2Image(parts[0].data)
        : { key: "firmware.rtl_bad_uf2", detail: "not a single UF2 part" };
    if ("key" in parsed) {
      return {
        error: `${localize(parsed.key)} (${parsed.detail})`,
        // The parser is a chunk of its own; the same bytes can parse next time.
        retryable: parsed.key === "firmware.engine_load_failed",
      };
    }
    const { image } = parsed;
    // Started with the parse so a failed engine fetch costs nothing later;
    // runAmbz2 names it.
    void loadAmbz2Engine().catch(() => {});
    const guide = {
      url: LIBRETINY_AMBZ2_GUIDE_URL,
      label: localize("firmware.rtl_guide_link"),
    };
    return {
      async run(port, hooks) {
        hooks.onState("connecting", localize("firmware.rtl_connecting"));
        const result = await runAmbz2(port, image, {
          onLog: hooks.onLog,
          onProgress: hooks.onProgress,
          onWaitingForStrap: () =>
            hooks.onWaiting({ message: localize("firmware.rtl_wait_desc"), guide }),
          onLinked: () =>
            hooks.onState("installing", localize("firmware.status_flashing")),
        });
        if ("detail" in result) {
          hooks.onState(
            "error",
            `${localize("firmware.rtl_flash_failed")}: ${result.detail}`
          );
          return null;
        }
        // Without control lines the board is still sitting in the ROM downloader.
        return result.rebooted
          ? result
          : {
              rebooted: false,
              note: { message: localize("firmware.rtl_done_manual_reset") },
            };
      },
    };
  },
};
