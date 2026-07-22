/**
 * Diff-and-splice support for `updateSectionInYaml` (#1227).
 *
 * Holds the per-key source-span model, structural value equality, and
 * the body assembler that copies untouched keys back byte-for-byte
 * while re-serializing only the keys the form changed. Kept apart from
 * the parser/update file so that already-oversized module doesn't grow
 * with this concern.
 */

import { isPlainObject, isPrimitiveOrNullish } from "./nested-values.js";
import type { ListItemSource } from "./yaml-section-list.js";
import {
  formatYamlFlowList,
  formatYamlScalar,
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
  // Per-item source fidelity for block scalar list keys, so an edited
  // list splices per item instead of re-emitting every row (#1363).
  listSources: Map<string, ListItemSource>;
  // Keys whose value was authored as a flow list (``key: [a, b]``), so an
  // edit re-emits the same single-line style — which also lets the
  // trailing-comment re-append below fire (#1378). Never overlaps
  // ``listSources``: the two are set in disjoint parse branches.
  flowListKeys: Set<string>;
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
    const spliced = span && spliceScalarList(lines, span, parsed, key, val);
    if (spliced) {
      bodyLines.push(...spliced);
      continue;
    }
    // Changed / added key. Keep any standalone-comment run that led the
    // original key — the value line below reformats, the comment stays.
    if (span) bodyLines.push(...lines.slice(span.leadStart, span.start));
    const fresh =
      flowListLine(parsed, key, val, childIndent) ??
      serializeYamlValues({ [key]: val }, childIndent, serializeOptions);
    // Re-append the field's trailing inline comment when it still
    // serializes to a single scalar line, so an edit keeps it (#1235).
    const comment = parsed.comments.get(key);
    if (comment && fresh.length === 1) fresh[0] += comment;
    bodyLines.push(...fresh);
  }
  return bodyLines;
}

/** A flow-authored key re-emits as the same single flow line (an emptied
 *  or non-scalar value falls through to the normal re-emit). */
function flowListLine(
  parsed: ParsedSection,
  key: string,
  val: unknown,
  childIndent: string
): string[] | null {
  if (!parsed.flowListKeys.has(key)) return null;
  if (!Array.isArray(val) || val.length === 0 || !val.every(isScalarItem)) return null;
  return [`${childIndent}${key}: ${formatYamlFlowList(val)}`];
}

// Deliberately stricter than ``isPrimitiveOrNullish``: a nullish item must
// fall through to the full re-emit, not reach ``formatYamlScalar``.
const isScalarItem = (v: unknown): v is string | number | boolean =>
  isPrimitiveOrNullish(v) && v != null;

/**
 * Per-item splice for a changed block scalar list (#1363): rows unchanged
 * at the same position (longest common prefix + suffix) keep their source
 * lines — inline comments, preceding whole-line comments, exact quoting —
 * and only the middle re-emits. An in-place edit (equal lengths) also
 * re-attaches each edited row's own inline comment. Returns ``null`` when
 * the key isn't a block scalar list on both sides (caller falls through to
 * the full re-emit), or when the new list is empty (the re-emit path owns
 * the drop-the-key semantic).
 */
function spliceScalarList(
  lines: string[],
  span: KeySpan,
  parsed: ParsedSection,
  key: string,
  val: unknown
): string[] | null {
  const src = parsed.listSources.get(key);
  const old = parsed.values[key];
  if (
    !src ||
    !Array.isArray(old) ||
    !Array.isArray(val) ||
    val.length === 0 ||
    !old.every(isScalarItem) ||
    !val.every(isScalarItem)
  ) {
    return null;
  }
  let prefix = 0;
  while (prefix < old.length && prefix < val.length && old[prefix] === val[prefix]) {
    prefix++;
  }
  let suffix = 0;
  while (
    suffix < old.length - prefix &&
    suffix < val.length - prefix &&
    old[old.length - 1 - suffix] === val[val.length - 1 - suffix]
  ) {
    suffix++;
  }
  const { itemLineIdxs: idxs, inlineComments, dashIndent } = src;
  // Each row's group runs from just past the previous row's line (the key
  // line for the first row), carrying the whole-line comments above it.
  const groupStart = (i: number): number => (i === 0 ? span.start + 1 : idxs[i - 1] + 1);
  const inPlace = old.length === val.length;
  const out: string[] = [];
  // Groups tile contiguously, so the lead + key line + prefix rows are one
  // slice, and the suffix rows + whatever the span still owns past the
  // last row (trailing comments) are another.
  out.push(...lines.slice(span.leadStart, groupStart(prefix)));
  for (let k = prefix; k < val.length - suffix; k++) {
    // A row unchanged between two edits keeps its bytes; an in-place edit
    // keeps the row's preceding comments and re-attaches its inline
    // comment — deliberately, even when the comment described the old
    // value: row comments label the row's role far more often than its
    // literal value. With add/remove the middle alignment is ambiguous,
    // so new middle rows emit plain.
    if (inPlace && old[k] === val[k]) {
      out.push(...lines.slice(groupStart(k), idxs[k] + 1));
      continue;
    }
    if (inPlace) out.push(...lines.slice(groupStart(k), idxs[k]));
    out.push(
      `${dashIndent}- ${formatYamlScalar(val[k])}${inPlace ? inlineComments[k] : ""}`
    );
  }
  out.push(...lines.slice(groupStart(old.length - suffix), span.end));
  return out;
}
