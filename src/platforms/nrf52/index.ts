/**
 * nRF52 API shared by the Device Builder and web.esphome.io. The DFU engine
 * stays out of the main chunk: only its types are re-exported, and
 * ``loadDfuEngine`` loads it on demand.
 */
export * from "./ble-nus-picker.js";
export * from "./ble-nus-stream.js";
export * from "./ble-probe-controller.js";
export * from "./manual-bootloader-hint.js";
export type * from "./nrf-dfu.js";
export * from "./nrf-logs-reset.js";
export * from "./nrf-platform.js";

export const loadDfuEngine = () => import("./nrf-dfu.js");
