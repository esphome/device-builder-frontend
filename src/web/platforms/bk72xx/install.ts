/** A Beken BK72xx as web.esphome.io installs it: through the chip's UART downloader. */
import { LIBRETINY_BEKEN_GUIDE_URL } from "../../../common/docs.js";
import {
  loadBekenEngine,
  loadBekenImage,
  runBeken,
} from "../../../platforms/bk72xx/index.js";
import type { LibreTinyInstall } from "../../install/libretiny-install-dialog.js";

export const BK_INSTALL: LibreTinyInstall = {
  copy: {
    title: "web.bk.install_title",
    intro: "web.bk.install_intro",
    connecting: "firmware.bk_connecting",
    connectDetail: "firmware.bk_connect_desc",
    waiting: "firmware.bk_wait_title",
    waitDetail: "firmware.bk_wait_desc",
    guideLink: "firmware.bk_guide_link",
    // Says where the logs are: the flash goes over UART1, the logs come from UART2.
    done: "firmware.bk_done",
    logsElsewhere: "web.bk.logs_elsewhere",
    failed: "firmware.bk_flash_failed",
    badFile: "firmware.bk_bad_uf2",
  },
  guideUrl: LIBRETINY_BEKEN_GUIDE_URL,
  loadEngine: loadBekenEngine,
  load: loadBekenImage,
  run: runBeken,
};
