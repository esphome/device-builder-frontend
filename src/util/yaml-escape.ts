/**
 * Escape helpers for unicode code points that are invisible in a text
 * field — control characters and Private-Use-Area glyphs (e.g. Material
 * Design Icon glyphs at ``\U000F058F``). Ordinary printable text
 * (letters, accents, emoji) is kept raw so a ``friendly_name`` like
 * ``Café`` survives unchanged. The escape *format* follows PyYAML's
 * emitter (uppercase hex; ``\x`` / ``\u`` / ``\U`` chosen by width).
 *
 * Two layers share the predicate below:
 *   - ``escapeYamlDoubleQuoted`` / ``unescapeYamlDoubleQuoted`` model a
 *     YAML double-quoted *scalar* — the short escapes the serializer emits
 *     (``\\`` ``\"`` ``\n`` ``\r`` ``\t``) plus numeric escapes; used by
 *     the serializer and section-value parser. It is not a full YAML
 *     escape set (no ``\0`` / ``\a`` / ``\f`` / ``\N`` etc.).
 *   - ``escapeForInput`` / ``unescapeForInput`` are a *narrower* pair for
 *     form inputs: only numeric (``\x`` / ``\u`` / ``\U``) escapes and the
 *     backslash, so editing a non-glyph multi_value field never rewrites
 *     a literal ``\t`` / quote / path the user typed.
 */

/** True for control / Private-Use code points that are written as escapes. */
export function isEscapeWorthy(cp: number): boolean {
  return (
    cp < 0x20 ||
    cp === 0x7f ||
    (cp >= 0x80 && cp <= 0x9f) ||
    (cp >= 0xe000 && cp <= 0xf8ff) ||
    (cp >= 0xf0000 && cp <= 0xffffd) ||
    (cp >= 0x100000 && cp <= 0x10fffd)
  );
}

/** True when any code point in *s* is escape-worthy. */
export function hasEscapeWorthyChar(s: string): boolean {
  for (const ch of s) {
    if (isEscapeWorthy(ch.codePointAt(0)!)) return true;
  }
  return false;
}

/** Render a code point as ``\xXX`` / ``\uXXXX`` / ``\UXXXXXXXX`` (uppercase hex). */
function escapeCodePoint(cp: number): string {
  if (cp <= 0xff) return `\\x${cp.toString(16).toUpperCase().padStart(2, "0")}`;
  if (cp <= 0xffff) return `\\u${cp.toString(16).toUpperCase().padStart(4, "0")}`;
  return `\\U${cp.toString(16).toUpperCase().padStart(8, "0")}`;
}

/**
 * Decode a ``\x`` / ``\u`` / ``\U`` numeric escape whose indicator is at
 * *idx*. Returns ``[char, charsConsumedAfterBackslash]``, or ``null`` for
 * a non-numeric, malformed, out-of-range, or lone-surrogate sequence.
 */
function decodeNumeric(s: string, idx: number): [string, number] | null {
  const esc = s[idx];
  const width = esc === "x" ? 2 : esc === "u" ? 4 : esc === "U" ? 8 : 0;
  if (!width) return null;
  const hex = s.slice(idx + 1, idx + 1 + width);
  if (hex.length !== width || !/^[0-9a-fA-F]+$/.test(hex)) return null;
  const cp = parseInt(hex, 16);
  if (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return null;
  return [String.fromCodePoint(cp), 1 + width];
}

// Per-character short escapes the *escape* side emits, keyed by the raw
// character; the YAML scalar form carries these, the form-input form
// carries none (control chars fall through to a numeric escape).
const NO_SHORT_ESCAPE: Record<string, string> = {};
const YAML_SHORT_ESCAPE: Record<string, string> = {
  '"': '\\"',
  "\n": "\\n",
  "\r": "\\r",
  "\t": "\\t",
};

// Short escapes the *unescape* side decodes, keyed by the indicator
// character after the backslash. The form-input form only collapses
// ``\\`` so a typed ``\t`` / path stays literal.
const BACKSLASH_ONLY_UNESCAPE: Record<string, string> = { "\\": "\\" };
const YAML_SHORT_UNESCAPE: Record<string, string> = {
  "\\": "\\",
  '"': '"',
  n: "\n",
  r: "\r",
  t: "\t",
};

// Always double a literal backslash so escape/unescape are invertible.
function escapeBody(s: string, short: Record<string, string>): string {
  let out = "";
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (ch === "\\") out += "\\\\";
    else if (short[ch] !== undefined) out += short[ch];
    else if (isEscapeWorthy(cp)) out += escapeCodePoint(cp);
    else out += ch;
  }
  return out;
}

// Decode numeric escapes plus *short*; any other backslash sequence keeps
// the backslash literal (so an unrecognized ``\Users`` isn't dropped).
function unescapeBody(s: string, short: Record<string, string>): string {
  if (!s.includes("\\")) return s;
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== "\\" || i + 1 >= s.length) {
      out += s[i];
      continue;
    }
    const num = decodeNumeric(s, i + 1);
    if (num) {
      out += num[0];
      i += num[1];
      continue;
    }
    const mapped = short[s[i + 1]];
    if (mapped !== undefined) {
      out += mapped;
      i += 1;
    } else {
      out += s[i];
    }
  }
  return out;
}

/**
 * Escape the body of a double-quoted YAML scalar (caller adds the
 * surrounding quotes): ``\`` / ``"`` / the short control forms, and
 * escape-worthy code points numerically so an MDI glyph becomes
 * ``\U000F058F`` instead of a bare invalid char.
 */
export function escapeYamlDoubleQuoted(s: string): string {
  return escapeBody(s, YAML_SHORT_ESCAPE);
}

/** Inverse of :func:`escapeYamlDoubleQuoted` — decode a double-quoted scalar body. */
export function unescapeYamlDoubleQuoted(s: string): string {
  return unescapeBody(s, YAML_SHORT_UNESCAPE);
}

/**
 * Show a stored value in a form input: double ``\`` and render
 * escape-worthy code points as ``\x`` / ``\u`` / ``\U`` so an invisible
 * glyph is editable. Unlike the YAML variant it leaves quotes and short
 * control forms alone — paired with :func:`unescapeForInput` it only
 * round-trips numeric escapes, so non-glyph list values are untouched.
 */
export function escapeForInput(s: string): string {
  return escapeBody(s, NO_SHORT_ESCAPE);
}

/**
 * Inverse of :func:`escapeForInput`. Decodes ``\\`` and numeric escapes
 * only; any other backslash sequence (``\t``, ``\Users``) is kept literal
 * so a path or regex typed into a multi_value field is not rewritten.
 */
export function unescapeForInput(s: string): string {
  return unescapeBody(s, BACKSLASH_ONLY_UNESCAPE);
}
