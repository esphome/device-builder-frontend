import { stripAnsiSgr } from "./ansi-escapes.js";

// Anchored ERROR prefix so a debug line that quotes the phrase can't match.
// Log format is "<asctime>? <LEVEL> <message>" (esphome/log.py).
const LOADER_ERROR = /^(?:\d{2}:\d{2}:\d{2}\s+)?ERROR Error while reading config:/;

// Any esphome CLI log record, same "<asctime>? <LEVEL> <message>" grammar.
// Whitespace (not \b) must follow the level so a payload line that merely
// starts with a level word (e.g. an `INFO:` YAML key) can't match.
const CLI_LOG_LINE =
  /^(?:\d{2}:\d{2}:\d{2}\s+)?(?:INFO|WARNING|ERROR|DEBUG|CRITICAL|VERBOSE)\s/;

/** True when an (ANSI-stripped) line is esphome CLI logging, not payload. */
export function isCliLogLine(line: string): boolean {
  return CLI_LOG_LINE.test(line);
}

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
