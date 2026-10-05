/** RTL87xx web install: the RTL8720C or RTL8710B ROM downloader, picked from the UF2's family. */
import {
  loadRtl87xxImage,
  type RtlImage,
  runAmbz,
  runAmbz2,
} from "../../../platforms/rtl87xx/index.js";
import type { LibreTinyInstall } from "../../install/libretiny-install-dialog.js";
import { RTL_AMBZ_INSTALL } from "./ambz-install.js";
import { RTL_INSTALL } from "./ambz2-install.js";

export const RTL87XX_INSTALL: LibreTinyInstall<RtlImage> = {
  // Until a file names its chip; title, intro and the bad-file line are shared.
  copy: RTL_INSTALL.copy,
  guideUrl: RTL_INSTALL.guideUrl,
  loadEngine: RTL_INSTALL.loadEngine,
  load: loadRtl87xxImage,
  run: (port, rtl, hooks) =>
    rtl.chip === "ambz"
      ? runAmbz(port, rtl.image, hooks)
      : runAmbz2(port, rtl.image, hooks),
  forImage: (rtl) => (rtl.chip === "ambz" ? RTL_AMBZ_INSTALL : RTL_INSTALL),
};
