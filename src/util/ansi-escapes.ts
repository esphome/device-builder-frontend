/**
 * Shared matcher for every ANSI escape sequence the dashboard handles.
 *
 * Matches one of three shapes:
 *   - CSI: `ESC [` <params> <intermediate> <final> — group 1 is the
 *     final byte. SGR (`m`) drives colors; everything else (cursor
 *     positioning, erase-line, DECTCEM `?25l/?25h`, ...) is silently
 *     discarded so it doesn't leak into rendered text.
 *   - OSC: `ESC ]` ... terminator — terminal title sets, hyperlinks,
 *     etc. Always discarded.
 *   - Two-char escapes: `ESC` + a single control char. Also discarded.
 * Final-byte / intermediate / parameter ranges follow ECMA-48.
 *
 * The introducer alternation matches BOTH the real `\x1b` byte AND
 * the four-character literal `\033` text that ESPHome's `--dashboard`
 * log formatter emits. ESPHome rewrites `\x1b` to literal `\033` so
 * `colorama` can't strip the codes when stdout is piped to us — without
 * matching the literal form here, the colours would render as plain
 * `\033[32m` text. The original ESPHome dashboard's frontend matches
 * both forms for the same reason.
 */
export const ANSI_ESCAPE_RE =
  /(?:\x1b|\\033)\[[\x30-\x3f]*[\x20-\x2f]*([\x40-\x7e])|(?:\x1b|\\033)\][^\x07\x1b]*(?:\x07|\x1b\\|\\033\\)|(?:\x1b|\\033)[NOPVWX^_=>]/g;

// Separate instance for replace-only stripping so it can't disturb the
// exec-loop lastIndex state of the shared matcher above.
const ANSI_STRIP_RE = new RegExp(ANSI_ESCAPE_RE.source, "g");

/** Strip every ANSI escape sequence (both forms) from *text*. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_STRIP_RE, "");
}
