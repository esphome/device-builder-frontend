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
import { connectFailureDetail } from "../../../util/serial-open-error.js";
import {
  type ReceiverEngine,
  singleWholePart,
} from "../../flash-receiver/receiver-engine.js";
import { serialRun } from "../../flash-receiver/serial-run.js";
import { parseFailureCopy } from "../../install/preparation.js";

export const rtlAmbz2ReceiverEngine: ReceiverEngine = {
  logs: RTL87XX_SERIAL_LOGS,
  async prepare(parts, _erase, localize) {
    const uf2 = singleWholePart(parts);
    const parsed = uf2
      ? await loadAmbz2Image(uf2)
      : { key: "firmware.rtl_bad_uf2", detail: "not a single UF2 part" };
    if ("key" in parsed) {
      // The parser is a chunk of its own; the same bytes can parse next time.
      const { key, retryable } = parseFailureCopy(parsed.key);
      return { error: `${localize(key)} (${parsed.detail})`, retryable };
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
      run: serialRun(localize, async (port, hooks) => {
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
            `${localize("firmware.rtl_flash_failed")}: ${connectFailureDetail(result.error, localize, () => result.detail)}`
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
      }),
    };
  },
};
