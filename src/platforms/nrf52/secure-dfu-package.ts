import type { DfuPackage } from "./nrf-dfu.js";

/**
 * Why Secure DFU cannot take ``pkg``, or undefined when it can: the engine
 * sends one application image over one session. ESPHome's ``bootloader: nrf``
 * build packages only that; a SoftDevice or bootloader image resets the
 * bootloader once executed, which pc-nrfutil follows with a reconnect.
 */
export function secureDfuRefusal(pkg: DfuPackage): string | undefined {
  const types = pkg.parts.map((p) => p.type);
  if (types.length === 1 && types[0] === "application") return undefined;
  const holds = types.length ? types.join(" + ") : "no image";
  return `the package holds ${holds}; Secure DFU over USB takes one application image`;
}
