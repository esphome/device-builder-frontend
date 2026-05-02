/**
 * Utility to strip ANSI SGR escape codes from log output.
 *
 * Two prefixes are handled:
 *
 * - The real escape byte ``\u001b`` (0x1B), produced by terminals and
 *   most colour-aware loggers — what ESPHome's own log lines carry
 *   over the WebSocket.
 * - The literal text ``\033`` (backslash + ``033``), which some
 *   build subprocesses (notably platformIO's filter chain feeding the
 *   firmware-job follow stream) emit instead of the real byte.
 *   Without this branch the saved download keeps those colour codes
 *   visible as ``\033[32m...\033[0m`` runs.
 *
 * Either prefix is followed by ``[`` + zero or more digit /
 * semicolon characters + ``m`` (the SGR — Select Graphic Rendition —
 * subset, which covers every colour / weight code in ESPHome output).
 */
const ANSI_REGEX = /(?:\u001b|\\033)\[[0-9;]*m/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_REGEX, "");
}
