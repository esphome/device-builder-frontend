/**
 * The flash receiver's nRF52 engine for the Adafruit bootloader: Nordic
 * legacy DFU over the bootloader's CDC, with a reconnect mid-flash.
 */
import { loadDfuEngine, loadDfuPackage } from "../../../platforms/nrf52/index.js";
import { nrfDfuReceiverEngine as nrfDfuReceiverEngineFor } from "./dfu-receiver-engine.js";

export const nrfDfuReceiverEngine = nrfDfuReceiverEngineFor({
  load: loadDfuPackage,
  copy: {
    step1: "firmware.nrf_step1_desc",
    step2Title: "firmware.nrf_step2_title",
    step2Desc: "firmware.nrf_step2_desc",
  },
  async flash(port, pkg, hooks, localize) {
    // A cache hit: the engine loaded when the package was parsed.
    const { flashDfuPackageWithReconnect } = await loadDfuEngine();
    await flashDfuPackageWithReconnect(port, pkg, {
      onProgress: hooks.onProgress,
      onLog: hooks.onLog,
      onReconnecting: () =>
        hooks.onState("installing", localize("firmware.nrf_reconnecting")),
    });
  },
});
