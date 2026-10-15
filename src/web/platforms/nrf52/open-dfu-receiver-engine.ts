/**
 * The flash receiver's engine for an nRF52 with Nordic's nRF5 SDK bootloader
 * (the nRF52840 Dongle): Secure DFU over the bootloader's own CDC, which the
 * firmware's pin reset enters on the 1200 baud touch.
 */
import {
  DONGLE_RESET_HINT_KEY,
  isNrfAppCdcPort,
  loadSecureDfuEngine,
  loadSecureDfuPackage,
  NRF_APP_PORT_FILTER,
  OPEN_DFU_PORT_FILTER,
} from "../../../platforms/nrf52/index.js";
import { nrfDfuReceiverEngine } from "./dfu-receiver-engine.js";

export const nrfOpenDfuReceiverEngine = nrfDfuReceiverEngine({
  load: loadSecureDfuPackage,
  copy: {
    step1: "firmware.nrf_open_step1_desc",
    step2Title: "firmware.nrf_open_step2_title",
    step2Desc: "firmware.nrf_open_step2_desc",
  },
  hintKey: DONGLE_RESET_HINT_KEY,
  touch: {
    filters: [NRF_APP_PORT_FILTER],
    accept: isNrfAppCdcPort,
    refusedKey: "firmware.nrf_open_port_refused",
  },
  pick: { filters: [OPEN_DFU_PORT_FILTER] },
  async flash(port, pkg, hooks) {
    const { flashSecureDfuPackage } = await loadSecureDfuEngine();
    await flashSecureDfuPackage(port, pkg, {
      onProgress: hooks.onProgress,
      onLog: hooks.onLog,
    });
  },
});
