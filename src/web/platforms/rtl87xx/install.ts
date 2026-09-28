/** The RTL8720C (AmebaZ2) as web.esphome.io installs it: through the ROM downloader. */
import { LIBRETINY_AMBZ2_GUIDE_URL } from "../../../common/docs.js";
import {
  loadAmbz2Engine,
  loadAmbz2Image,
  runAmbz2,
} from "../../../platforms/rtl87xx/index.js";
import type { LibreTinyInstall } from "../../install/libretiny-install-dialog.js";

export const RTL_INSTALL: LibreTinyInstall = {
  copy: {
    title: "web.rtl.install_title",
    intro: "web.rtl.install_intro",
    connecting: "firmware.rtl_connecting",
    connectDetail: "firmware.rtl_connect_desc",
    waiting: "firmware.rtl_wait_title",
    waitDetail: "firmware.rtl_wait_desc",
    guideLink: "firmware.rtl_guide_link",
    done: "web.rtl.install_done",
    doneByHand: "firmware.rtl_done_manual_reset",
    failed: "firmware.rtl_flash_failed",
    badFile: "firmware.rtl_bad_uf2",
  },
  guideUrl: LIBRETINY_AMBZ2_GUIDE_URL,
  loadEngine: loadAmbz2Engine,
  load: loadAmbz2Image,
  run: runAmbz2,
};
