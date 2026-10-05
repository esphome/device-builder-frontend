/** The RTL8710B (AmebaZ) as web.esphome.io installs it: through the ROM downloader. */
import { LIBRETINY_AMBZ_GUIDE_URL } from "../../../common/docs.js";
import {
  type AmbzImage,
  loadAmbzEngine,
  loadAmbzImage,
  runAmbz,
} from "../../../platforms/rtl87xx/index.js";
import type { LibreTinyInstall } from "../../install/libretiny-install-dialog.js";

export const RTL_AMBZ_INSTALL: LibreTinyInstall<AmbzImage> = {
  copy: {
    title: "web.rtl_ambz.install_title",
    intro: "web.rtl_ambz.install_intro",
    connecting: "firmware.rtl_connecting",
    connectDetail: "firmware.rtl_ambz_connect_desc",
    waiting: "firmware.rtl_wait_title",
    waitDetail: "firmware.rtl_ambz_wait_desc",
    guideLink: "firmware.rtl_ambz_guide_link",
    done: "web.rtl.install_done",
    doneByHand: "web.rtl_ambz.install_done_reset",
    // Never booted by the engine, and its log is on the flash port.
    logsNotice: "firmware.rtl_ambz_done_reset",
    failed: "firmware.rtl_flash_failed",
    badFile: "firmware.rtl_bad_uf2",
  },
  guideUrl: LIBRETINY_AMBZ_GUIDE_URL,
  loadEngine: loadAmbzEngine,
  load: loadAmbzImage,
  run: runAmbz,
};
