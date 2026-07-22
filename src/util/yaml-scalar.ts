/**
 * Scalar-value parsing primitives for the section editor's minimal YAML
 * reader: quote stripping, inline-comment splitting, scalar/boolean
 * coercion, and flow-list (`[a, b]`) parsing. Kept separate from the
 * section parser/update logic so that already-oversized module doesn't
 * keep growing.
 */

import type { LambdaValue } from "../api/types/automations.js";
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

// Inline lambda scalar: ``!lambda return x;`` (and the quoted
// ``!lambda 'return x;'`` form). Recognised as a ``LambdaValue``
// so a templatable field shows the lambda editor instead of a
// string field holding the literal ``!lambda …`` text. The block
// form (``!lambda |-``) is captured by the reader's block-scalar
// branch before reaching here.
const INLINE_LAMBDA_RE = /^!lambda\s+([\s\S]+)$/;

const parseInlineLambda = (scalar: string): LambdaValue | null => {
  const m = scalar.match(INLINE_LAMBDA_RE);
  return m ? { _lambda: stripQuotes(m[1].trim()), _tag: "!lambda" } : null;
};

// ``isQuotedScalar`` must see the scalar BEFORE ``stripQuotes`` — the
// quotes are the signal that suppresses coercion.
export const parseScalar = (raw: string): unknown => {
  // Strip a trailing inline comment so plain scalars coerce and no field
  // value is polluted with `# ...` text (#1235).
  const { value: scalar } = splitInlineComment(raw);
  const lambda = parseInlineLambda(scalar);
  if (lambda !== null) return lambda;
  return coerceYamlScalar(stripQuotes(scalar), isQuotedScalar(scalar));
};

// Plain-decimal forms only: unambiguous across YAML versions. Hex stays a
// string (the i2c-address round-trip keeps ``0x76`` verbatim), and a leading
// zero (``010``) or exponent stays a string too — YAML 1.1 reads ``010`` as
// octal 8, so Number() would silently rewrite it. Deliberately narrower
// than yaml-serialize's YAML_INT/YAML_FLOAT recognition sets (which decide
// quoting, so must match every form the loader re-types) and int-input's
// DECIMAL_INT_RE (form input, leading zeros fine): coerce only what
// Number() provably reads the same as the loader.
const PLAIN_INT_RE = /^[-+]?(?:0|[1-9]\d*(?:_\d+)*)$/;
const PLAIN_FLOAT_RE =
  /^[-+]?(?:(?:0|[1-9]\d*(?:_\d+)*)\.(?:\d+(?:_\d+)*)?|\.\d+(?:_\d+)*)$/;

/** Quoting in YAML is the explicit "treat me as a string" signal; the
 *  scalar and list-item readers share one definition of "quoted". */
export const isQuotedScalar = (s: string): boolean =>
  s.length >= 2 &&
  ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")));

/**
 * A plain scalar's parsed value — fields and list items share this rule.
 * Unquoted plain decimals become numbers and truthy/falsy spellings
 * become booleans, so the serializer re-emits them bare — string-typed
 * ``10`` re-quoted on every re-serialize (#1353/#1360), and a string
 * ``on`` re-emitted quoted where the loader had read a boolean. A >2^53
 * decimal stays a string (Number() would silently rewrite the digits,
 * #378/#944).
 */
export const coerceYamlScalar = (
  text: string,
  wasQuoted: boolean
): string | number | boolean => {
  if (wasQuoted) return text;
  const bool = parseYamlBoolean(text);
  if (bool !== null) return bool;
  // Underscore digit separators (``1_000``) are loader numerics; strip
  // them for Number() once the shape matched (between digits only, a
  // strict subset of the resolver's grammar).
  if (PLAIN_INT_RE.test(text)) {
    const n = Number(text.replace(/_/g, ""));
    return Number.isSafeInteger(n) ? n : text;
  }
  // Floats trade text fidelity for the loader's value: ``1.50`` re-emits
  // as ``1.5`` and extra precision truncates to the same double PyYAML
  // hands the backend anyway. An overflowing mantissa stays a string —
  // the serializer would emit a bare ``Infinity``, which YAML reads as
  // a plain string anyway.
  if (PLAIN_FLOAT_RE.test(text)) {
    const n = Number(text.replace(/_/g, ""));
    return Number.isFinite(n) ? n : text;
  }
  return text;
};

export const parseFlowList = (raw: string): (string | number | boolean)[] => {
  const inner = raw.slice(1, -1).trim();
  if (inner === "") return [];
  // Quote-aware split: a quoted element may itself contain a comma (the
  // serializer quotes such scalars), which a plain ``split(",")`` would
  // fracture into extra items. Double-quoted elements are unescaped so a
  // font glyph like ``\U000F058F`` becomes the real code point, not the
  // literal backslash text (device-builder#1232).
  return splitTopLevelCommas(inner).map((p) => {
    const t = p.trim();
    if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
      return unescapeYamlDoubleQuoted(t.slice(1, -1));
    }
    return coerceYamlScalar(stripQuotes(t), isQuotedScalar(t));
  });
};
