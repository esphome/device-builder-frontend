/**
 * The Realtek RTL87xx as web.esphome.io installs it: through the chip's ROM
 * downloader, picked from the UF2's family. ``RTL_INSTALL`` is the RTL8720C
 * (AmebaZ2) alone, as the flash receiver's ``rtl-ambz2`` engine takes it.
 */
import { LIBRETINY_AMBZ2_GUIDE_URL } from "../../../common/docs.js";
import type { LibreTinyImage } from "../../../platforms/libretiny-uf2.js";
import {
  type AmbzImage,
  loadAmbz2Engine,
  loadAmbz2Image,
  loadAmbzImage,
  runAmbz,
  runAmbz2,
} from "../../../platforms/rtl87xx/index.js";
import type { LibreTinyInstall } from "../../install/libretiny-install-dialog.js";
import { RTL_AMBZ_INSTALL } from "./ambz-install.js";

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

/** A parsed RTL87xx UF2 and the chip it was built for. */
export type RtlImage =
  { chip: "ambz2"; image: LibreTinyImage } | { chip: "ambz"; image: AmbzImage };

export const RTL87XX_INSTALL: LibreTinyInstall<RtlImage> = {
  copy: RTL_INSTALL.copy,
  guideUrl: RTL_INSTALL.guideUrl,
  loadEngine: RTL_INSTALL.loadEngine,
  // An RTL8710B build is the other Realtek family to the RTL8720C parser.
  async load(bytes) {
    const ambz2 = await loadAmbz2Image(bytes);
    if ("image" in ambz2) return { image: { chip: "ambz2", image: ambz2.image } };
    if (ambz2.key !== "firmware.rtl_wrong_family") return ambz2;
    const ambz = await loadAmbzImage(bytes);
    return "image" in ambz ? { image: { chip: "ambz", image: ambz.image } } : ambz;
  },
  run: (port, rtl, hooks) =>
    rtl.chip === "ambz"
      ? runAmbz(port, rtl.image, hooks)
      : runAmbz2(port, rtl.image, hooks),
  forImage: (rtl) => (rtl.chip === "ambz" ? AMBZ : AMBZ2),
};

// Each chip's copy, guide and engine, flashed through the family's dispatch.
const chip = (
  install: Pick<LibreTinyInstall<never>, "copy" | "guideUrl" | "loadEngine">
): LibreTinyInstall<RtlImage> => ({
  ...RTL87XX_INSTALL,
  copy: install.copy,
  guideUrl: install.guideUrl,
  loadEngine: install.loadEngine,
  forImage: undefined,
});
const AMBZ2 = chip(RTL_INSTALL);
const AMBZ = chip(RTL_AMBZ_INSTALL);
