/** RTL87xx web install: the ROM downloader of the chip the UF2 was built for, picked from its family. */
import {
  loadRtl87xxImage,
  type RtlImage,
  runAmbd,
  runAmbz,
  runAmbz2,
} from "../../../platforms/rtl87xx/index.js";
import type {
  LibreTinyChip,
  LibreTinyInstall,
} from "../../install/esphome-web-libretiny-install-dialog.js";
import { RTL_AMBD_INSTALL } from "./ambd-install.js";
import { RTL_AMBZ_INSTALL } from "./ambz-install.js";
import { RTL_AMBZ2_INSTALL } from "./ambz2-install.js";

/** Each chip's copy, guide and engine; the record keeps the list complete. */
const CHIPS: Record<RtlImage["chip"], LibreTinyChip> = {
  ambz2: RTL_AMBZ2_INSTALL,
  ambz: RTL_AMBZ_INSTALL,
  ambd: RTL_AMBD_INSTALL,
};

export const RTL87XX_INSTALL: LibreTinyInstall<RtlImage> = {
  // Until a file names its chip: the shared title, intro and bad-file line;
  // guideUrl and loadEngine are placeholders forImage always replaces.
  copy: RTL_AMBZ2_INSTALL.copy,
  guideUrl: RTL_AMBZ2_INSTALL.guideUrl,
  loadEngine: RTL_AMBZ2_INSTALL.loadEngine,
  load: loadRtl87xxImage,
  run: (port, rtl, hooks) => {
    switch (rtl.chip) {
      case "ambz2":
        return runAmbz2(port, rtl.image, hooks);
      case "ambz":
        return runAmbz(port, rtl.image, hooks);
      case "ambd":
        return runAmbd(port, rtl.image, hooks);
    }
  },
  forImage: (rtl) => CHIPS[rtl.chip],
  // The user picks the chip; the parsed image picks its downloader. No
  // ESPHome Web firmware is published for the RTL8720D yet.
  prebuilt: { families: ["RTL8720C", "RTL8710B"] },
};
