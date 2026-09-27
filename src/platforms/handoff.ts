/**
 * The flasher a web.esphome.io hand-off is for, by an id both apps share:
 * ``"esp"`` is esptool (ESP32 / ESP8266), ``"rtl-ambz2"`` the RTL8720C ROM
 * downloader. Named after the flasher, not the platform: ``rtl87xx`` covers
 * the RTL8710B too, whose ROM speaks another protocol and gets its own id
 * when it lands. Absent on the wire means ``"esp"``, so older dashboards and
 * receivers are unchanged (see ``src/web/flash-receiver/protocol.ts``).
 */
export type HandoffFlasher = "esp" | "rtl-ambz2";
export const DEFAULT_HANDOFF_FLASHER: HandoffFlasher = "esp";
export const HANDOFF_FLASHERS: readonly HandoffFlasher[] = ["esp", "rtl-ambz2"];

/** Whether an untrusted frame's ``flasher`` names one this build knows. */
export function isHandoffFlasher(value: unknown): value is HandoffFlasher {
  return (HANDOFF_FLASHERS as readonly unknown[]).includes(value);
}
