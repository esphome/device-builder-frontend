/**
 * The flash receiver's RTL8720C engine: the LibreTiny UF2 handed over as one
 * part is parsed here, and the AmebaZ2 ROM downloader writes it, the same
 * engine the in-app flow and the web RTL dialog use. The RTL8710B is not this
 * engine: its ROM speaks another protocol and gets its own id and module.
 */
import { LIBRETINY_AMBZ2_GUIDE_URL } from "../../../common/docs.js";
import {
  loadAmbz2Engine,
  loadLibreTinyParser,
  RTL87XX_SERIAL_LOGS,
} from "../../../platforms/rtl87xx/index.js";
import type { LibreTinyImage } from "../../../platforms/rtl87xx/libretiny-uf2.js";
import { getErrorMessage } from "../../../util/error-message.js";
import type { ReceiverEngine } from "../../flash-receiver/receiver-engine.js";
import type { FlashPart } from "../esp/firmware-build.js";

async function parseImage(
  parts: FlashPart[]
): Promise<{ image: LibreTinyImage } | { error: string; key: string }> {
  // One part, the whole UF2, at address 0; anything else is not this hand-off.
  if (parts.length !== 1 || parts[0].address !== 0) {
    return { error: "not a single UF2 part", key: "firmware.rtl_bad_uf2" };
  }
  const parser = await loadLibreTinyParser();
  try {
    return { image: parser.parseAmbz2Image(parts[0].data) };
  } catch (err) {
    return {
      error: getErrorMessage(err),
      key: err instanceof parser.Ambz2ImageError ? err.key : "firmware.rtl_bad_uf2",
    };
  }
}

export const rtlAmbz2ReceiverEngine: ReceiverEngine = {
  logs: RTL87XX_SERIAL_LOGS,
  async validate(parts, localize) {
    const parsed = await parseImage(parts);
    return "error" in parsed ? `${localize(parsed.key)} (${parsed.error})` : null;
  },
  async run(port, parts, _erase, hooks) {
    const parsed = await parseImage(parts);
    if ("error" in parsed) {
      hooks.onState("error", `${hooks.localize(parsed.key)} (${parsed.error})`);
      return false;
    }
    hooks.onState("connecting", hooks.localize("firmware.rtl_connecting"));
    let rebooted: boolean;
    try {
      const { flashAmbz2 } = await loadAmbz2Engine();
      rebooted = await flashAmbz2(port, parsed.image, {
        onLog: hooks.onLog,
        onProgress: hooks.onProgress,
        onWaitingForStrap: () =>
          hooks.onWaiting?.(
            hooks.localize("firmware.rtl_wait_desc"),
            LIBRETINY_AMBZ2_GUIDE_URL
          ),
        onLinked: () =>
          hooks.onState("installing", hooks.localize("dashboard.status_installing")),
      });
    } catch (err) {
      hooks.onState(
        "error",
        `${hooks.localize("firmware.rtl_flash_failed")}: ${getErrorMessage(err)}`
      );
      return false;
    }
    // Without control lines the board is still sitting in the ROM downloader.
    if (!rebooted) hooks.onWaiting?.(hooks.localize("firmware.rtl_done_manual_reset"));
    return true;
  },
};
