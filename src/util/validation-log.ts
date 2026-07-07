import { stripAnsiSgr } from "./ansi-escapes.js";

// Anchored ERROR prefix so a debug line that quotes the phrase can't match.
// Log format is "<asctime>? <LEVEL> <message>" (esphome/log.py).
const LOADER_ERROR = /^(?:\d{2}:\d{2}:\d{2}\s+)?ERROR Error while reading config:/;

/**
 * True when a compile-log line marks an ESPHome validation failure.
 *
 * Two distinct markers:
 *   "Failed config" — bold-red schema-validator banner from esphome/config.py
 *   "ERROR Error while reading config: …" — YAML-load step _LOGGER.error
 * Both indicate the build never reached C++ compile, so clean/reset
 * suggestions can't help; the command and firmware-install dialogs use
 * this to route the user to the YAML editor instead.
 */
export function isValidationFailureLine(line: string): boolean {
  const stripped = stripAnsiSgr(line).trim();
  if (stripped === "Failed config") return true;
  return LOADER_ERROR.test(stripped);
}
