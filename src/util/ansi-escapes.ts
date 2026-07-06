/**
 * Shared matchers for every ANSI escape sequence the dashboard handles.
 *
 * One escape is one of three shapes:
 *   - CSI: `ESC [` <params> <intermediate> <final> — the final byte
 *     selects the command. SGR (`m`) drives colors; everything else
 *     (cursor positioning, erase-line, DECTCEM `?25l/?25h`, ...) is
 *     silently discarded so it doesn't leak into rendered text.
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
 *
 * The variants below are composed from one set of fragments so the
 * shapes can't drift apart.
 */
const INTRODUCER = /(?:\x1b|\\033)/.source;
const CSI_PARAMS = /\[[\x30-\x3f]*[\x20-\x2f]*/.source;
const OSC = /\][^\x07\x1b]*(?:\x07|\x1b\\|\\033\\)/.source;
const TWO_CHAR = /[NOPVWX^_=>]/.source;

// One full escape; *csiFinal* is the CSI final-byte character class.
const escapeSource = (csiFinal: string): string =>
  `${INTRODUCER}${CSI_PARAMS}${csiFinal}|${INTRODUCER}${OSC}|${INTRODUCER}${TWO_CHAR}`;

// Group 1 is the CSI final byte — parseAnsiLine keys SGR handling off it.
export const ANSI_ESCAPE_RE = new RegExp(escapeSource("([\\x40-\\x7e])"), "g");

/** Leading run of non-SGR escapes only — colours (final byte ``m``,
 *  0x6d) survive so log lines keep their palette after cleaning. */
export const ANSI_LEADING_NON_SGR_RE = new RegExp(
  `^(?:${escapeSource("[\\x40-\\x6c\\x6e-\\x7e]")})*`
);

// Separate instance for replace-only stripping so it can't disturb the
// exec-loop lastIndex state of the shared matcher above.
const ANSI_STRIP_RE = new RegExp(ANSI_ESCAPE_RE.source, "g");

/** Strip every ANSI escape sequence (both forms) from *text*. */
export function stripAnsi(text: string): string {
  // Escape-free fast path — most compile-log lines carry no ANSI at all.
  if (!text.includes("\x1b") && !text.includes("\\033")) return text;
  return text.replace(ANSI_STRIP_RE, "");
}
