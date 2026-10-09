/** RTL87xx web install: the RTL8720C, RTL8710B or RTL8720D ROM downloader, picked from the UF2's family. */
import {
  loadRtl87xxImage,
  type RtlImage,
  runAmbd,
  runAmbz,
  runAmbz2,
} from "../../../platforms/rtl87xx/index.js";
import type { LibreTinyInstall } from "../../install/esphome-web-libretiny-install-dialog.js";
import { RTL_AMBD_INSTALL } from "./ambd-install.js";
import { RTL_AMBZ_INSTALL } from "./ambz-install.js";
import { RTL_AMBZ2_INSTALL } from "./ambz2-install.js";

export const RTL87XX_INSTALL: LibreTinyInstall<RtlImage> = {
  // Until a file names its chip: the shared title, intro and bad-file line;
  // guideUrl and loadEngine are placeholders forImage always replaces.
  copy: RTL_AMBZ2_INSTALL.copy,
  guideUrl: RTL_AMBZ2_INSTALL.guideUrl,
  loadEngine: RTL_AMBZ2_INSTALL.loadEngine,
  load: loadRtl87xxImage,
  run: (port, rtl, hooks) => {
    switch (rtl.chip) {
      case "ambz":
        return runAmbz(port, rtl.image, hooks);
      case "ambd":
        return runAmbd(port, rtl.image, hooks);
      default:
        return runAmbz2(port, rtl.image, hooks);
    }
  },
  forImage: (rtl) => {
    switch (rtl.chip) {
      case "ambz":
        return RTL_AMBZ_INSTALL;
      case "ambd":
        return RTL_AMBD_INSTALL;
      default:
        return RTL_AMBZ2_INSTALL;
    }
  },
  // The user picks the chip; the parsed image picks its downloader. No
  // ESPHome Web firmware is published for the RTL8720D yet.
  prebuilt: { families: ["RTL8720C", "RTL8710B"] },
};
