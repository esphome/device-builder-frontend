/**
 * Diff-and-splice support for `updateSectionInYaml` (#1227).
 *
 * Holds the per-key source-span model, structural value equality, and
 * the body assembler that copies untouched keys back byte-for-byte
 * while re-serializing only the keys the form changed. Kept apart from
 * the parser/update file so that already-oversized module doesn't grow
 * with this concern.
 */

import { isPlainObject } from "./nested-values.js";
import {
  serializeYamlValues,
  YamlRawValue,
  type SerializeYamlOptions,
} from "./yaml-serialize.js";

/**
 * A top-level key's source-line span within a section body. Both
 * fields are 0-indexed into the section's lines array; ``[start, end)``
 * is half-open. ``leadStart <= start`` extends over the contiguous
 * blank / standalone-comment run that visually precedes the key, so a
 * verbatim copy carries that key's own comments with it.
 */
export interface KeySpan {
  start: number;
  end: number;
  leadStart: number;
}

export interface ParsedSection {
  values: Record<string, unknown>;
  // One span per top-level key, in file order. The inline-on-dash key
  // (list items) is intentionally absent — it lives on the section
  // header line, which `updateSectionInYaml` owns directly.
  spans: Map<string, KeySpan>;
  // Trailing inline comment (with its leading whitespace, e.g.
  // ` #hides`) per scalar key that had one, so a re-serialized edit can
  // re-append it instead of dropping it (#1235).
  comments: Map<string, string>;
  childIndent: string;
  isListItem: boolean;
  // 0-indexed section header / leading-dash line.
  startIdx: number;
}

/**
 * Structural equality for the value shapes the section parser emits —
 * primitives, null, null-prototype mappings, ``string[]`` / ``Record[]``
 * arrays, and ``YamlRawValue`` (compared by header + body lines so an
 * untouched lambda stays verbatim). Not a general deep-equal; the
 * exotic shapes (Map / Set / Date / function) never reach here.
 */
export function yamlValueEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a instanceof YamlRawValue || b instanceof YamlRawValue) {
    return (
      a instanceof YamlRawValue &&
      b instanceof YamlRawValue &&
      a.inlineHeader === b.inlineHeader &&
      a.lines.length === b.lines.length &&
      a.lines.every((line, i) => line === b.lines[i])
    );
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, i) => yamlValueEqual(item, b[i]))
    );
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ak = Object.keys(a);
    if (ak.length !== Object.keys(b).length) return false;
    return ak.every(
      (k) => Object.prototype.hasOwnProperty.call(b, k) && yamlValueEqual(a[k], b[k])
    );
  }
  return false;
}

/**
 * Build the spliced section body: each form key the value of which
 * matches the on-disk parse keeps its source lines verbatim; the rest
 * (and added keys) re-serialize through the normal path. `inlineKeys`
 * are the list-item dash keys the caller already represents on the
 * header line, so they're skipped here (#1227).
 */
export function buildSplicedBody(
  lines: string[],
  parsed: ParsedSection,
  values: Record<string, unknown>,
  inlineKeys: Set<string>,
  childIndent: string,
  serializeOptions: SerializeYamlOptions
): string[] {
  const bodyLines: string[] = [];
  for (const [key, val] of Object.entries(values)) {
    if (inlineKeys.has(key)) continue;
    const span = parsed.spans.get(key);
    if (span && yamlValueEqual(val, parsed.values[key])) {
      bodyLines.push(...lines.slice(span.leadStart, span.end));
      continue;
    }
    // Changed / added key. Keep any standalone-comment run that led the
    // original key — the value line below reformats, the comment stays.
    if (span) bodyLines.push(...lines.slice(span.leadStart, span.start));
    const fresh = serializeYamlValues({ [key]: val }, childIndent, serializeOptions);
    // Re-append the field's trailing inline comment when it still
    // serializes to a single scalar line, so an edit keeps it (#1235).
    const comment = parsed.comments.get(key);
    if (comment && fresh.length === 1) fresh[0] += comment;
    bodyLines.push(...fresh);
  }
  return bodyLines;
}
