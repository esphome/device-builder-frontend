/**
 * Parse and rewrite key: value pairs in a section of a YAML document.
 *
 * Supports scalars (quoted/unquoted, booleans), block lists of scalars,
 * flow lists (`[a, b, c]`), and recursively-nested objects. Designed for
 * the section editor — round-trips the values that ConfigEntry forms
 * read and write — not as a general YAML parser.
 */

import { ESPHOME_YAML_INDENT } from "./esphome-yaml-lang.js";
import { LIST_SECTIONS } from "./section-entry-overrides.js";
import {
  _detectSectionChildIndent,
  _leadingIndent,
  isCommentLine,
  LIST_ITEM_INLINE_KEY_RE,
  LIST_ITEM_START_RE,
  TOP_LEVEL_KEY_START_RE,
} from "./yaml-section-lexer.js";
import { findSectionStart, parseSectionCore } from "./yaml-section-reader.js";
import { buildSplicedBody, yamlValueEqual } from "./yaml-section-splice.js";
import {
  formatYamlScalar,
  serializeYamlValues,
  type SerializeYamlOptions,
} from "./yaml-serialize.js";

/**
 * Find the 0-indexed line range [start, end) for a section.
 *
 * For list-item-rooted sections, termination is on a sibling dash
 * at the SAME indent as the leading dash (or a top-level key) —
 * NOT just any indented dash. A nested list inside the section's
 * value (e.g. an automation list under `on_press:` whose dashes
 * sit deeper than the section's leading dash) is part of the
 * section, not a sibling, and clipping the range there leaves the
 * nested content outside the splice — which then survives the
 * save and re-appears as duplicate stale lines under the new
 * serialized output. That regression was visible as a template
 * button's `on_press` lambda body persisting verbatim after the
 * form-side save mangled the on_press header.
 */
export function findSectionRange(
  lines: string[],
  sectionKey: string,
  fromLine?: number
): { start: number; end: number } {
  const start = findSectionStart(lines, sectionKey, fromLine);
  if (start < 0) return { start: -1, end: -1 };

  const isListItem = LIST_ITEM_START_RE.test(lines[start]);
  const siblingDashIndent = isListItem
    ? (lines[start].match(/^(\s*)-/) ?? ["", ""])[1].length
    : -1;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (isListItem) {
      const dashMatch = lines[i].match(/^(\s*)-(\s|$)/);
      if (dashMatch && dashMatch[1].length === siblingDashIndent) {
        end = i;
        break;
      }
      if (TOP_LEVEL_KEY_START_RE.test(lines[i])) {
        end = i;
        break;
      }
    } else if (TOP_LEVEL_KEY_START_RE.test(lines[i])) {
      end = i;
      break;
    }
  }
  return { start, end };
}

/** Indent of the deepest non-blank, non-comment line in ``[start, end)``
 *  — the section's deepest real value line, used to tell a trailing
 *  comment apart from block-scalar body text. Must be the maximum, not
 *  the last line's: a nested mapping earlier in the section can be deeper
 *  than the final value, and a trailing comment between the two indents
 *  is a real comment to preserve, not block text. Falls back to the
 *  section's child indent when the section has no such line. */
function _deepestValueLineIndent(
  lines: string[],
  start: number,
  end: number,
  fallback: number
): number {
  let deepest = -1;
  for (let i = start + 1; i < end; i++) {
    const line = lines[i];
    if (line.trim() === "" || isCommentLine(line)) continue;
    const indent = _leadingIndent(line).length;
    if (indent > deepest) deepest = indent;
  }
  return deepest < 0 ? fallback : deepest;
}

/**
 * Replace the body of a section in a YAML document with `values`.
 *
 * ``options.keepEmptyStrings`` opts the serializer out of dropping
 * empty-string values. Required for top-level user-keyed sections
 * (``substitutions:``) where every key the user typed is
 * intentional data and ``""`` is a valid value the YAML must
 * round-trip; left at the default ``false`` for ordinary
 * config-entries where ``""`` means "user cleared the field".
 */
export function updateSectionInYaml(
  yaml: string,
  sectionKey: string,
  values: Record<string, unknown>,
  fromLine?: number,
  options: SerializeYamlOptions = {}
): string {
  const lines = yaml.split("\n");
  const { start, end } = findSectionRange(lines, sectionKey, fromLine);
  if (start < 0) return yaml;

  // List-item vs map shape and the section's child indent drive both
  // the trailing-comment trim below and the serializer's indent step.
  const isListItem = LIST_ITEM_START_RE.test(lines[start]);
  const childIndent = _detectSectionChildIndent(lines, start, isListItem);

  // The range runs to the next top-level key, swallowing trailing
  // blank lines and trailing comments the splice would then wipe. Stop
  // the splice before that run so those lines survive verbatim. This
  // indent heuristic is the fallback for the `globals` path below, which
  // has no per-key spans; the main per-key path overrides `spliceEnd`
  // with the parser's exact value end once it has parsed (see below).
  // A trailing comment counts as a YAML comment (preserve) when it's at
  // the section's child indent or shallower OR shallower than the deepest
  // value line's indent (a block scalar's body sits deeper than its key,
  // so a comment between the two is a real comment, not block text).
  // (`> start + 1` keeps the header.)
  const bodyIndent = _deepestValueLineIndent(lines, start, end, childIndent.length);
  let runStart = end;
  while (runStart > start + 1) {
    const prev = lines[runStart - 1];
    if (prev.trim() === "") {
      runStart--;
      continue;
    }
    const prevIndent = _leadingIndent(prev).length;
    if (
      isCommentLine(prev) &&
      (prevIndent <= childIndent.length || prevIndent < bodyIndent)
    ) {
      runStart--;
    } else {
      break;
    }
  }
  let spliceEnd = runStart;

  // Top-level list-bodied section (globals): re-emit through the
  // mapping serializer's array branch — { sectionKey: array } yields
  // `sectionKey:` plus the dash items at the detected child indent
  // (canonical 2-space when the body was a zero-indented sequence).
  if (LIST_SECTIONS.has(sectionKey)) {
    const raw = values[sectionKey];
    // No array → leave the YAML untouched rather than collapse the
    // block to a bare header, which would wipe every item.
    if (!Array.isArray(raw)) return yaml;
    // Emptied list (every item deleted) → drop the whole block instead
    // of leaving an invalid bare `sectionKey:`. serializeYamlValues
    // skips empty arrays, so the splice removes header + body.
    const block = serializeYamlValues(
      { [sectionKey]: raw },
      _leadingIndent(lines[start]),
      {
        ...options,
        indentStep: options.indentStep ?? (childIndent || ESPHOME_YAML_INDENT),
      }
    );
    lines.splice(start, spliceEnd - start, ...block);
    return lines.join("\n");
  }

  // Re-parse the original to recover each key's source-line span and
  // on-disk value — the diff below needs both.
  const parsed = parseSectionCore(lines, sectionKey, fromLine);

  // The parser already pinned each value's exact end — block scalars via
  // `_blockScalarBodyEnd`, so a `#` indented at/past the block content
  // indent is body and a less-indented one is a trailing comment. The
  // last value's span end is therefore the real start of the trailing
  // run, exactly where the indent heuristic above can only approximate
  // (it underestimates an all-`#` block body and can't see a nested
  // mapping deeper than the final value). Use it so the splice boundary
  // and the parse extent agree on every block body.
  let lastContentEnd = -1;
  for (const span of parsed.spans.values()) {
    if (span.end > lastContentEnd) lastContentEnd = span.end;
  }
  if (lastContentEnd >= 0) spliceEnd = lastContentEnd;

  // `childIndent` (detected above) also matches the user's existing
  // indent step on save, so 4-space (or other consistent) YAML isn't
  // re-emitted with a mixed 2-space slice.
  let dashLine = lines[start];
  // Keys carried inline on the list-item dash are represented by
  // `dashLine`, not the body — the per-key loop skips them.
  const inlineKeys = new Set<string>();
  if (isListItem) {
    // List items can carry a key/value inline with the dash
    // (`- platform: esphome`). `parseYamlSectionValues` reads
    // that key into `values`; if we re-serialize it under the
    // dash line it gets emitted twice — once on the dash, once
    // as a regular child — the visible
    // `- platform: esphome\n    platform: esphome` duplicate
    // users reported as "Save adds another esphome item".
    //
    // The form is the authoritative source for the inline key.
    // Three cases, all of which yield the inline key exactly
    // once in the output (or zero times when the form dropped
    // it):
    //
    //   1. inline key absent from form: dash kept as-is, body
    //      emitted normally. Original behaviour.
    //   2. form value is an inline-able scalar (string / number
    //      / boolean): the dash carries it (skipped from the
    //      body). Unchanged → kept byte-for-byte so a trailing
    //      `# comment` survives; changed → rewritten from the
    //      form's value. Also handles the empty-inline
    //      (`- platform:`) and stale-inline cases.
    //   3. form value is non-scalar (object / array / null /
    //      undefined): collapse the dash to bare `-` and let
    //      the body serializer emit the inline key at the
    //      child indent. The dash can't represent a multi-line
    //      value, so demoting to a bare list-item head is the
    //      only way to keep the inline key from appearing
    //      twice. For object / array values that produces an
    //      inline-key block under the dash; for null /
    //      undefined the serializer drops the key entirely
    //      (the "zero times" arm of the contract above).
    //
    // Same `LIST_ITEM_INLINE_KEY_RE` (`yaml-section-lexer.ts`) that
    // `parseYamlSectionValues` (`yaml-section-reader.ts`) reads, so the
    // two sides stay in lockstep on what counts as an inline key.
    const inlineMatch = dashLine.match(LIST_ITEM_INLINE_KEY_RE);
    if (inlineMatch) {
      const inlineKey = inlineMatch[1];
      // Own-property check, not `in`: callers can hand us a
      // regular `{}` from form-side spreads / `setIn`, where
      // `"constructor" in values` is `true` because every plain
      // object inherits from `Object.prototype`. Treating that as
      // "form set the key" would rewrite the dash from a
      // prototype-inherited value and lose the YAML's actual
      // inline content. (`Object.prototype.hasOwnProperty.call`
      // rather than `Object.hasOwn` for tsconfig-target reach.)
      if (Object.prototype.hasOwnProperty.call(values, inlineKey)) {
        if (_isInlinableScalar(values[inlineKey])) {
          inlineKeys.add(inlineKey);
          // Only rewrite the dash when the form changed the inline
          // value; an unchanged value stays byte-for-byte so its
          // trailing comment / original quoting survive.
          if (!yamlValueEqual(values[inlineKey], parsed.values[inlineKey])) {
            // The match always succeeds here: we entered via
            // `LIST_ITEM_INLINE_KEY_RE`, which requires `\s*` before
            // and `\s+` after the dash. The non-null assertion makes
            // that invariant local.
            const dashPrefixMatch = dashLine.match(/^(\s*)-(\s+)/)!;
            const dashPrefix = `${dashPrefixMatch[1]}-${dashPrefixMatch[2]}`;
            const comment = parsed.comments.get(inlineKey) ?? "";
            dashLine = `${dashPrefix}${inlineKey}: ${formatYamlScalar(values[inlineKey])}${comment}`;
          }
        } else {
          // Non-scalar form value: drop the inline key from the
          // dash and let the body serializer emit everything,
          // including the now-non-inline key.
          const dashIndent = (dashLine.match(/^(\s*)-/) ?? ["", ""])[1];
          dashLine = `${dashIndent}-`;
        }
      }
    }
  }
  // For non-list-item sections the user's indent step IS the
  // section's child indent (top-level keys at column 0, children
  // at one step deeper). Pass that through so nested-mapping
  // recursion preserves the user's chosen step end-to-end.
  //
  // For list-item sections the picture is messier — child keys
  // align with the inline first key after the dash, not at a
  // step-multiple — and there's no clean "user step" to read off.
  // Default to canonical 2-space; the round-trip stays
  // valid-and-readable even when the surrounding file uses a
  // different step elsewhere.
  const detectedStep = !isListItem && childIndent ? childIndent : ESPHOME_YAML_INDENT;
  const serializeOptions = { ...options, indentStep: options.indentStep ?? detectedStep };

  // Splice only what changed (#1227): untouched keys keep their source
  // lines byte-for-byte; the rest re-serialize through the normal path.
  const newLines = [
    dashLine,
    ...buildSplicedBody(lines, parsed, values, inlineKeys, childIndent, serializeOptions),
  ];
  lines.splice(start, spliceEnd - start, ...newLines);
  return lines.join("\n");
}

/**
 * True when *value* can be emitted on the dash line as
 * `- key: <value>`. Strings, numbers, booleans qualify; objects,
 * arrays, null, and undefined need the body representation.
 */
function _isInlinableScalar(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  const t = typeof value;
  return t === "string" || t === "number" || t === "boolean";
}

/**
 * Remove a section (top-level block or single list item) from a YAML
 * document. When deleting a list item leaves its parent block with
 * nothing but blank lines, the empty parent is removed too — both to
 * avoid a stray `sensor:` that ESPHome rejects, and to keep the
 * resulting YAML tidy.
 */
export function removeSectionFromYaml(
  yaml: string,
  sectionKey: string,
  fromLine?: number
): string {
  const lines = yaml.split("\n");
  const { start, end } = findSectionRange(lines, sectionKey, fromLine);
  if (start < 0) return yaml;

  const isListItem = LIST_ITEM_START_RE.test(lines[start]);
  lines.splice(start, end - start);

  if (isListItem) {
    // Walk backwards to the parent top-level key; if nothing but
    // blanks remain between it and the next sibling, drop it too.
    let parentIdx = start - 1;
    while (parentIdx >= 0 && !TOP_LEVEL_KEY_START_RE.test(lines[parentIdx])) {
      parentIdx--;
    }
    if (parentIdx >= 0) {
      let hasContent = false;
      let parentEnd = lines.length;
      for (let i = parentIdx + 1; i < lines.length; i++) {
        if (TOP_LEVEL_KEY_START_RE.test(lines[i])) {
          parentEnd = i;
          break;
        }
        if (lines[i].trim() !== "") {
          hasContent = true;
          break;
        }
      }
      if (!hasContent) {
        lines.splice(parentIdx, parentEnd - parentIdx);
      }
    }
  }

  return lines.join("\n");
}
