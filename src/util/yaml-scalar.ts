/**
 * Scalar-value parsing primitives for the section editor's minimal YAML
 * reader: quote stripping, inline-comment splitting, scalar/boolean
 * coercion, and flow-list (`[a, b]`) parsing. Kept separate from the
 * section parser/update logic so that already-oversized module doesn't
 * keep growing.
 */

import { splitTopLevelCommas } from "./split-top-level-commas.js";
import { unescapeYamlDoubleQuoted } from "./yaml-escape.js";
import { parseYamlBoolean } from "./yaml-serialize.js";

export const stripQuotes = (s: string): string => {
  if (s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1);
  }
  if (s.startsWith("'") && s.endsWith("'")) {
    // YAML single-quote escape: a doubled `''` is a literal `'`.
    return s.slice(1, -1).replace(/''/g, "'");
  }
  return s;
};

/**
 * Split a scalar's raw text into its value and a trailing inline
 * comment (``true #hides`` → ``{ value: "true", comment: " #hides" }``).
 * A ``#`` only starts a comment when it's whitespace-preceded and
 * outside quotes — ``Bedroom#2`` and ``"a # b"`` keep the ``#`` in the
 * value. ``comment`` retains its leading whitespace (``""`` when none)
 * so the serializer can re-append it verbatim.
 */
export const splitInlineComment = (raw: string): { value: string; comment: string } => {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    // Backslash escapes the next char inside a double-quoted scalar
    // (`"a \" # b"`), so it can't desync the quote tracker. Single
    // quotes escape via `''`, which the toggle already handles.
    if (c === "\\" && inDouble) {
      i++;
      continue;
    }
    if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (
      c === "#" &&
      !inSingle &&
      !inDouble &&
      (raw[i - 1] === " " || raw[i - 1] === "\t")
    ) {
      let ws = i;
      while (ws > 0 && (raw[ws - 1] === " " || raw[ws - 1] === "\t")) ws--;
      return { value: raw.slice(0, ws), comment: raw.slice(ws) };
    }
  }
  return { value: raw, comment: "" };
};

// Quoting in YAML is the explicit "treat me as a string" signal —
// ``key: "on"`` must stay the literal ``"on"`` even though ``on`` is
// a truthy spelling. Detect the quotes BEFORE stripping so we only
// run the boolean coercion on plain scalars; otherwise a string
// field that happens to hold ``"on"`` / ``"yes"`` would silently
// flip to boolean ``true`` on round-trip.
export const parseScalar = (raw: string): unknown => {
  // Strip a trailing inline comment so a boolean/number field coerces
  // and the form value isn't polluted with `# ...` text (#1235).
  const { value: scalar } = splitInlineComment(raw);
  const wasQuoted =
    (scalar.startsWith('"') && scalar.endsWith('"')) ||
    (scalar.startsWith("'") && scalar.endsWith("'"));
  const v = stripQuotes(scalar);
  if (!wasQuoted) {
    const bool = parseYamlBoolean(v);
    if (bool !== null) return bool;
  }
  return v;
};

export const parseFlowList = (raw: string): string[] => {
  const inner = raw.slice(1, -1).trim();
  if (inner === "") return [];
  // Quote-aware split: a quoted element may itself contain a comma (the
  // serializer quotes such scalars), which a plain ``split(",")`` would
  // fracture into extra items. Double-quoted elements are unescaped so a
  // font glyph like ``\U000F058F`` becomes the real code point, not the
  // literal backslash text (device-builder#1232).
  return splitTopLevelCommas(inner).map((p) => {
    const t = p.trim();
    return t.length >= 2 && t.startsWith('"') && t.endsWith('"')
      ? unescapeYamlDoubleQuoted(t.slice(1, -1))
      : stripQuotes(t);
  });
};
