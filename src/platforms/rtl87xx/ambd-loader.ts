/**
 * The RTL8720D's second stage: the ROM only writes RAM, so the host first
 * loads Realtek's flash loader into SRAM and talks to that. The file is not
 * ours to redistribute, so it is fetched at flash time from the commit of
 * Realtek's own Arduino repository that ships it, and checked against the
 * hash of that copy before it goes near a chip.
 */
import { pinnedFetch } from "../../util/pinned-fetch.js";

/** Realtek's copy (``ameba-arduino-d`` at tag V3.1.9), served by jsDelivr from the pinned commit. */
export const AMBD_LOADER_URL =
  "https://cdn.jsdelivr.net/gh/Ameba-AIoT/ameba-arduino-d@52aac0dd423cbb11a013711c8e1c3004adf31ef8/Ameba_misc/Image_Releated/imgtool_flashloader_amebad.bin";
export const AMBD_LOADER_SHA256 =
  "9307121385cb390dfd2da64da2c6c515f17b5a9556b3d04021487c9b9f220b55";

/** The loader could not be fetched, or it is not the file the hash names. */
export class AmbdLoaderError extends Error {
  constructor(
    readonly key:
      "firmware.rtl_ambd_loader_unavailable" | "firmware.rtl_ambd_loader_mismatch",
    message: string
  ) {
    super(message);
    this.name = "AmbdLoaderError";
  }
}

const loader = pinnedFetch(AMBD_LOADER_URL, AMBD_LOADER_SHA256, (kind, detail) =>
  kind === "unavailable"
    ? new AmbdLoaderError(
        "firmware.rtl_ambd_loader_unavailable",
        `Could not download the RTL8720D flash loader: ${detail}`
      )
    : new AmbdLoaderError(
        "firmware.rtl_ambd_loader_mismatch",
        `The RTL8720D flash loader does not match its expected hash (got ${detail})`
      )
);

/**
 * The loader, fetched once per page and only when its hash matches. A
 * failed fetch is forgotten so that Retry fetches again.
 */
export const loadAmbdLoader = loader.load;

/** Forget the fetched copy; for tests. */
export const resetAmbdLoaderForTests = loader.reset;
