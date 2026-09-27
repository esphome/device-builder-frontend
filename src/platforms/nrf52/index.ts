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
export * from "./nrf-logs-reset.js";
export * from "./nrf-platform.js";
export * from "./serial-logs.js";
export * from "./smp-ble-service.js";
export type * from "./smp-engine.js";

import { getErrorMessage } from "../../util/error-message.js";
import type { DfuPackage } from "./nrf-dfu.js";
import type { McubootImage } from "./smp-engine.js";

export const loadDfuEngine = () => import("./nrf-dfu.js");
export const loadSmpEngine = () => import("./smp-engine.js");

/** Why a DFU package could not be parsed: the copy for the user and the detail. */
export interface DfuPackageFailure {
  key: "firmware.engine_load_failed" | "firmware.nrf_bad_package";
  detail: string;
}

/**
 * Parse a DFU package with the on-demand engine, for the in-app install and
 * the web dialog. A failed chunk fetch and a bad package each name their
 * own copy; never throws.
 */
export async function loadDfuPackage(
  bytes: Uint8Array
): Promise<{ pkg: DfuPackage } | DfuPackageFailure> {
  let engine: Awaited<ReturnType<typeof loadDfuEngine>>;
  try {
    engine = await loadDfuEngine();
  } catch (err) {
    console.error("[nrf52] Could not load the parser chunk:", err);
    return { key: "firmware.engine_load_failed", detail: getErrorMessage(err) };
  }
  try {
    return { pkg: engine.parseDfuPackage(bytes) };
  } catch (err) {
    return { key: "firmware.nrf_bad_package", detail: getErrorMessage(err) };
  }
}

/** Why an MCUboot image could not be parsed: the copy for the user and the detail. */
export interface McubootImageFailure {
  key: "firmware.engine_load_failed" | "firmware.nrf_bad_mcuboot_image";
  detail: string;
}

/** ``loadDfuPackage`` for an MCUboot update image; never throws. */
export async function loadMcubootImage(
  bytes: Uint8Array
): Promise<{ image: McubootImage } | McubootImageFailure> {
  let engine: Awaited<ReturnType<typeof loadSmpEngine>>;
  try {
    engine = await loadSmpEngine();
  } catch (err) {
    console.error("[nrf52] Could not load the MCUboot chunk:", err);
    return { key: "firmware.engine_load_failed", detail: getErrorMessage(err) };
  }
  try {
    return { image: await engine.parseMcubootImage(bytes) };
  } catch (err) {
    return { key: "firmware.nrf_bad_mcuboot_image", detail: getErrorMessage(err) };
  }
}
