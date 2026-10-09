/** RTL8720D (AmebaD) install via its ROM downloader and the flash loader it is given. */
import { LIBRETINY_AMBD_GUIDE_URL } from "../../../common/docs.js";
import {
  type AmbdImage,
  loadAmbdEngine,
  loadAmbdImage,
  runAmbd,
} from "../../../platforms/rtl87xx/index.js";
import type { LibreTinyInstall } from "../../install/esphome-web-libretiny-install-dialog.js";
import { RTL_COPY } from "./copy.js";

export const RTL_AMBD_INSTALL: LibreTinyInstall<AmbdImage> = {
  copy: {
    ...RTL_COPY,
    connectDetail: "firmware.rtl_ambd_connect_desc",
    waitDetail: "firmware.rtl_ambd_wait_desc",
    guideLink: "firmware.rtl_ambd_guide_link",
    doneByHand: "firmware.rtl_ambd_done_manual_reset",
  },
  guideUrl: LIBRETINY_AMBD_GUIDE_URL,
  loadEngine: loadAmbdEngine,
  load: loadAmbdImage,
  run: runAmbd,
};
