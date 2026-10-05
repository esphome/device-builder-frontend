/** RTL8720C (AmebaZ2) install via its ROM downloader. */
import { LIBRETINY_AMBZ2_GUIDE_URL } from "../../../common/docs.js";
import {
  loadAmbz2Engine,
  loadAmbz2Image,
  runAmbz2,
} from "../../../platforms/rtl87xx/index.js";
import type { LibreTinyInstall } from "../../install/libretiny-install-dialog.js";
import { RTL_COPY } from "./copy.js";

export const RTL_AMBZ2_INSTALL: LibreTinyInstall = {
  copy: {
    ...RTL_COPY,
    connectDetail: "firmware.rtl_connect_desc",
    waitDetail: "firmware.rtl_wait_desc",
    guideLink: "firmware.rtl_guide_link",
    doneByHand: "firmware.rtl_done_manual_reset",
  },
  guideUrl: LIBRETINY_AMBZ2_GUIDE_URL,
  loadEngine: loadAmbz2Engine,
  load: loadAmbz2Image,
  run: runAmbz2,
};
