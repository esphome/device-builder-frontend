/** RTL8710B (AmebaZ) install via its ROM downloader. */
import { LIBRETINY_AMBZ_GUIDE_URL } from "../../../common/docs.js";
import {
  type AmbzImage,
  loadAmbzEngine,
  loadAmbzImage,
  runAmbz,
} from "../../../platforms/rtl87xx/index.js";
import type { LibreTinyInstall } from "../../install/libretiny-install-dialog.js";
import { RTL_COPY } from "./copy.js";

export const RTL_AMBZ_INSTALL: LibreTinyInstall<AmbzImage> = {
  copy: {
    ...RTL_COPY,
    connectDetail: "firmware.rtl_ambz_connect_desc",
    waitDetail: "firmware.rtl_ambz_wait_desc",
    guideLink: "firmware.rtl_ambz_guide_link",
    doneByHand: "web.rtl.install_done_reset",
    // Never booted by the engine, and its log is on the flash port.
    logsNotice: "firmware.rtl_ambz_done_reset",
  },
  guideUrl: LIBRETINY_AMBZ_GUIDE_URL,
  loadEngine: loadAmbzEngine,
  load: loadAmbzImage,
  run: runAmbz,
};
