/** An LN882H as web.esphome.io installs it: through the chip's UART downloader. */
import { LIBRETINY_LN882H_FLASHING_URL } from "../../../common/docs.js";
import {
  loadLn882xImage,
  runLn882x,
  warmLn882x,
} from "../../../platforms/ln882x/index.js";
import type { LibreTinyInstall } from "../../install/libretiny-install-dialog.js";

export const LN_INSTALL: LibreTinyInstall = {
  copy: {
    title: "web.ln.install_title",
    intro: "web.ln.install_intro",
    connecting: "firmware.ln_connecting",
    connectDetail: "firmware.ln_connect_desc",
    waiting: "firmware.ln_wait_title",
    waitDetail: "firmware.ln_wait_desc",
    guideLink: "firmware.ln_guide_link",
    done: "firmware.status_done",
    doneByHand: "firmware.ln_done_manual_reset",
    // The flash goes over UART0; the logs come from UART1 by default.
    logsElsewhere: "web.ln.logs_elsewhere",
    failed: "firmware.ln_flash_failed",
    badFile: "firmware.ln_bad_uf2",
  },
  guideUrl: LIBRETINY_LN882H_FLASHING_URL,
  // The RAM code too, which the engine fetches before it touches the port.
  loadEngine: warmLn882x,
  load: loadLn882xImage,
  run: runLn882x,
};
