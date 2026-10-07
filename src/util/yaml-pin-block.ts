/* Line-based readers for long-form pin blocks. */

import { parsePinGpio } from "./pin/gpio.js";
import { readInstanceScalar } from "./yaml-instance-scalars.js";
import { indentOf } from "./yaml-line-walker.js";

// Leading `key:` of an indented (or list-item) mapping line. Captures the
// leading indentation (group 1) and the key (group 2) so a block-scalar
// value under a free-text key can be skipped by indentation.
export const LINE_KEY_RE = /^(\s*)(?:-\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\s*:/;

/**
 * Strip a YAML inline comment. A `#` begins a comment only at line start
 * or when preceded by whitespace (so `http://x#y` keeps its `#`). Pin
 * values never contain `#`, so cutting here can't drop a real pin token —
 * but it does keep a `# spare PA02` trailing comment from registering a
 * phantom pin.
 *
 * This is intentionally NOT quote-aware: a `#` inside a quoted scalar
 * (`id: "x # GPIO5"`) is treated as a comment start and truncated. That's
 * fine here — the strip is false-positive-only, and a pin-shaped token
 * buried in a quoted comment-like tail was already a phantom match before
 * this strip existed. Real pin values are never quoted-with-`#`, so quote
 * tracking (single vs double, escapes, flow scalars) would add complexity
 * for a case that can't surface a real conflict. Don't "fix" it.
 */
export function stripInlineComment(line: string): string {
  const m = line.match(/(^|\s)#/);
  return m === null ? line : line.slice(0, (m.index ?? 0) + m[1].length);
}

/**
 * Read a long-form pin block opened at `openerIdx` (a `pin:` / `*_pin:` key
 * with no inline value) into its canonical identity via {@link parsePinGpio} — a
 * board GPIO `number`, or the `provider:hub:channel` token when the block
 * sits on an I/O expander. Reconstructs the block's scalars (one nested level)
 * into a mapping and defers the identity decision to `parsePinGpio`. Returns
 * the identity plus the 0-indexed last line the block spans so the caller can
 * skip past it.
 */
export function readLongFormPin(
  lines: string[],
  openerIdx: number
): { pin: number | string | null; end: number } {
  const openIndent = indentOf(lines[openerIdx]);
  let childIndent = -1;
  const block: Record<string, unknown> = {};
  let end = openerIdx;
  // A block-style child's direct children (hub selector, mode flags).
  let nested: Record<string, unknown> | null = null;
  let nestedIndent = -1;
  for (let j = openerIdx + 1; j < lines.length; j++) {
    const line = lines[j];
    if (line.trim() === "") {
      end = j;
      continue;
    }
    const indent = indentOf(line);
    if (indent <= openIndent) break;
    end = j;
    const m = line.match(LINE_KEY_RE);
    if (m === null) continue; // comment / non-key line — don't anchor childIndent on it
    if (childIndent === -1) childIndent = indent;
    if (indent !== childIndent) {
      if (nested !== null) {
        if (nestedIndent === -1) nestedIndent = indent;
        if (indent === nestedIndent) nested[m[2]] = readPinBlockScalar(line, m[2]);
      }
      continue;
    }
    // Record the key even when it has no inline scalar (an empty, mid-edit
    // 'pcf8574:'), so parsePinGpio sees the provider and returns null rather
    // than letting the bare 'number:' alias a board GPIO.
    const scalar = readPinBlockScalar(line, m[2]);
    nested = scalar === null ? {} : null;
    nestedIndent = -1;
    block[m[2]] = nested ?? scalar;
  }
  return { pin: parsePinGpio(block), end };
}

/** A pin block line's inline scalar; a flow collection reads as '' (unresolved). */
function readPinBlockScalar(line: string, key: string): string | null {
  const scalar = readInstanceScalar(stripInlineComment(line), key);
  return scalar !== null && /^[[{]/.test(scalar) ? "" : scalar;
}
