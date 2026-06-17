/**
 * Stateful ESPHome log parser — ports the algorithm from
 * ``aioesphomeapi``'s ``log_parser.py`` (the same logic the
 * ``esphome logs`` CLI uses) so client-side log sources render
 * identically to the backend-streamed ones.
 *
 * Why this exists: ESPHome emits a multi-line config record (e.g. a
 * ``[C]`` ``dump_config`` block) as a *single* log message — the color
 * is opened on the first line and the reset only lands on the last; the
 * continuation lines are merely indented, with no header and no color
 * of their own. When the message is split on ``\n`` (as the WebSerial
 * reader does, reading raw UART bytes), each continuation line ends up
 * colorless and prefix-less.
 *
 * The backend's ``esphome logs`` CLI avoids this by running every line
 * through aioesphomeapi's ``LogParser``, which records the entry line's
 * prefix + color and re-applies them to each continuation line. Logs
 * that don't reach the backend (WebSerial — read straight off the
 * device UART) need the same treatment in the browser; this module is
 * that treatment.
 *
 * It is intentionally timestamp-agnostic: callers prepend their own
 * ``[HH:MM:SS]`` prefix after parsing, which reproduces aioesphomeapi's
 * ``timestamp + color + prefix + line`` continuation shape.
 */

// Reset emitted in real-ESC form (what the device sends); the renderer
// (ansi-log) accepts both the ESC byte and the literal ``\033`` text.
const ANSI_RESET = "\u001b[0m";

// A leading SGR color sequence in either form ESPHome uses: the real
// ESC byte (device UART) or the literal ``\033`` text (backend transport).
const LEADING_COLOR_RE = /^(?:\u001b|\\033)\[[0-9;]*m/;

// True when a line carries any ANSI sequence — used to decide whether a
// trailing reset is needed so color can't bleed past the line.
const HAS_ANSI_RE = /(?:\u001b|\\033)\[/;

// Strip CSI escape sequences (both ESC-byte and literal \033 forms) so the
// garbage heuristic counts content bytes, not color codes.
const ANSI_STRIP_RE = /(?:\u001b|\\033)\[[0-9;?]*[ -\/]*[@-~]/g;

/**
 * True when a decoded UART line looks like baud-mismatch garbage rather than a
 * real log line. An ESP8266 prints its boot/reset banner at 74880 baud; read at
 * the app's (lower) configured baud it mis-samples into mojibake: U+FFFD
 * replacement chars and non-printable control bytes. Clean ESPHome logs are
 * printable ASCII plus ANSI escapes, so they never trip this. Short lines are
 * never flagged (too little signal; the line cap bounds any that slip by).
 */
export function isLikelyGarbageLine(line: string): boolean {
  const stripped = line.replace(ANSI_STRIP_RE, "").replace(/\u001b/g, "");
  if (stripped.length < 2) return false;
  let bad = 0;
  for (const ch of stripped) {
    const code = ch.codePointAt(0) ?? 0;
    // Tab is fine; U+FFFD, DEL, and other C0 controls signal corruption.
    if (ch === "\ufffd" || code === 0x7f || (code < 0x20 && code !== 0x09)) bad++;
  }
  return bad / stripped.length > 0.3;
}

/** Already ends in a reset (either escape form)? */
function endsWithReset(line: string): boolean {
  return line.endsWith("\u001b[0m") || line.endsWith("\\033[0m");
}

/** A line needs a trailing reset when it opened color but never closed it. */
function needsReset(line: string): boolean {
  return line.length > 0 && HAS_ANSI_RE.test(line) && !endsWithReset(line);
}

/** Split an entry line into its leading color code and its ``…]:`` prefix
 *  (the prefix carries no color so the color can be re-applied
 *  independently on continuation lines). */
function extractPrefixAndColor(line: string): { prefix: string; color: string } {
  let color = "";
  let rest = line;
  const colorMatch = LEADING_COLOR_RE.exec(line);
  if (colorMatch) {
    color = colorMatch[0];
    rest = line.slice(color.length);
  }
  const bracketColon = rest.indexOf("]:");
  const prefix = bracketColon !== -1 ? rest.slice(0, bracketColon + 2) : "";
  return { prefix, color };
}

/**
 * Streaming parser: feed it one raw device line at a time (no
 * timestamp) and it returns the line with color/prefix carried onto
 * continuation lines. One instance per log session — it threads the
 * last entry's prefix + color across calls.
 */
export class ESPHomeLogParser {
  private _prefix = "";
  private _color = "";

  /** Parse a single raw line (without trailing newline). */
  parseLine(line: string): string {
    // Blank lines (empty or whitespace-only) carry nothing and must NOT
    // disturb the carried entry context — a bare line inside a multi-line
    // record (or a ``\n\n`` that splits to "") would otherwise clear the
    // prefix/color and leave the rest of the block uncolored.
    if (line.trim() === "") return line;

    // Continuation detection keys off leading whitespace rather than
    // aioesphomeapi's "doesn't match the [X][tag]: entry regex" test. This
    // is a deliberate adaptation for the raw UART stream, which interleaves
    // non-ESPHome output (esptool / PlatformIO) at column 0: that output
    // must pass through as plain new-entry lines, not be re-colored as
    // continuations of a preceding ESPHome record.
    if (!/^\s/.test(line)) {
      const { prefix, color } = extractPrefixAndColor(line);
      this._prefix = prefix;
      this._color = color;
      return needsReset(line) ? line + ANSI_RESET : line;
    }

    // No entry seen yet (stream joined mid-record): just close any color.
    if (!this._prefix && !this._color) {
      return needsReset(line) ? line + ANSI_RESET : line;
    }

    // Re-apply the entry's color + prefix so the continuation renders
    // like the backend's per-line output: ``<color>[…]: <content><reset>``.
    const body = this._prefix ? `${this._prefix} ${line}` : line;
    const out = `${this._color}${body}`;
    return this._color && !endsWithReset(out) ? out + ANSI_RESET : out;
  }
}
