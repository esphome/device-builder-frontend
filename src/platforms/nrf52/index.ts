/**
 * nRF52 API shared by the Device Builder and web.esphome.io. The DFU and
 * MCUboot engines stay out of the main chunk: only their types are
 * re-exported, and ``loadDfuEngine`` / ``loadSmpEngine`` load them on demand.
 */
export * from "./ble-nus-picker.js";
export * from "./ble-nus-stream.js";
export * from "./ble-probe-controller.js";
export * from "./manual-bootloader-hint.js";
export type * from "./nrf-dfu.js";
export type * from "./nrf-secure-dfu.js";
export * from "./nrf-logs-reset.js";
export * from "./nrf-platform.js";
export * from "./secure-dfu-package.js";
export * from "./serial-logs.js";
export * from "./smp-ble-service.js";
export type * from "./smp-engine.js";

import { type ChunkParseFailure, parseWith } from "../lazy-chunk.js";
import type { DfuPackage } from "./nrf-dfu.js";
import { secureDfuRefusal } from "./secure-dfu-package.js";
import type { McubootImage } from "./smp-engine.js";

export const loadDfuEngine = () => import("./nrf-dfu.js");
export const loadSecureDfuEngine = () => import("./nrf-secure-dfu.js");
export const loadSmpEngine = () => import("./smp-engine.js");

/** Why a DFU package could not be parsed: the copy for the user and the detail. */
export type DfuPackageFailure = ChunkParseFailure<"firmware.nrf_bad_package">;

/** Parse a DFU package with the on-demand engine, for the in-app install and the web dialog; never throws. */
export const loadDfuPackage = (
  bytes: Uint8Array
): Promise<{ pkg: DfuPackage } | DfuPackageFailure> =>
  parseWith(
    "[nrf52 DFU]",
    loadDfuEngine,
    (e) => ({ pkg: e.parseDfuPackage(bytes) }),
    () => "firmware.nrf_bad_package"
  );

/** ``loadDfuPackage`` for the Secure DFU engine, which takes one application image; never throws. */
export async function loadSecureDfuPackage(
  bytes: Uint8Array
): Promise<{ pkg: DfuPackage } | DfuPackageFailure> {
  const parsed = await loadDfuPackage(bytes);
  if ("key" in parsed) return parsed;
  const refusal = secureDfuRefusal(parsed.pkg);
  return refusal ? { key: "firmware.nrf_bad_package", detail: refusal } : parsed;
}

/** Why an MCUboot image could not be parsed: the copy for the user and the detail. */
export type McubootImageFailure = ChunkParseFailure<"firmware.nrf_bad_mcuboot_image">;

/** ``loadDfuPackage`` for an MCUboot update image; never throws. */
export const loadMcubootImage = (
  bytes: Uint8Array
): Promise<{ image: McubootImage } | McubootImageFailure> =>
  parseWith(
    "[nrf52 MCUboot]",
    loadSmpEngine,
    async (e) => ({ image: await e.parseMcubootImage(bytes) }),
    () => "firmware.nrf_bad_mcuboot_image"
  );
