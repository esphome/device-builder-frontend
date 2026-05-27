/**
 * Shared formatting helpers for YAML-content search UIs.
 *
 * The command palette and the dashboard's YAML mode both render
 * results from the same ``YamlSearchController``. The hit-list
 * rendering itself differs (palette materialises hits as
 * ``CommandAction`` rows alongside other commands; dashboard
 * renders standalone link cards) but the per-row label format,
 * the click-target href, and the empty-state copy are identical.
 *
 * This module owns those three shared concerns so a tweak to the
 * label format / URL shape / empty-state phrasing lands in one
 * place. Anything that still needs duplicating across the two
 * call sites is inherently UI-specific (the command-palette
 * action shape, the dashboard's standalone cards) and stays in
 * each component.
 */

import type { LocalizeFunc } from "../common/localize.js";
import type { YamlSearchHit, YamlSearchMatch } from "../api/types.js";
import {
  ALWAYS_SENSITIVE_KEYS,
  findSensitiveValueRanges,
} from "./yaml-sensitive-scan.js";

const MASK_PLACEHOLDER = "••••••••";

/**
 * True when *key* names a credential whose value should never
 * appear in a search-result label. Combines two sources:
 *
 * - The shared ``ALWAYS_SENSITIVE_KEYS`` allowlist from the
 *   editor's mask scan (``password``/``ap_password`` etc).
 * - A ``*_password`` / ``*_psk`` suffix heuristic so
 *   user-defined substitution keys (``wifi_password:`` under a
 *   top-level ``substitutions:`` block, or any other place
 *   someone names their own credential field) are masked too.
 *
 * The single-line context here means we can't do parent-scope
 * reasoning the way the editor's scan does — so the heuristic
 * is deliberately a touch wider here. Over-masking a row is a
 * cosmetic blemish; under-masking leaks a credential.
 */
function isSensitiveKey(key: string): boolean {
  if (ALWAYS_SENSITIVE_KEYS.has(key)) return true;
  return /_(password|psk)$/i.test(key);
}

/**
 * Strip the inline credential value from a line of YAML so it
 * can be safely shown in a search-result label.
 *
 * The YAML editor masks credentials via
 * ``sensitiveValueMaskExtension``; the search-results dropdown
 * has to render the raw matched line, which would otherwise
 * leak ``password: hunter2`` into the palette / dashboard.
 *
 * Only keys flagged by ``isSensitiveKey`` are masked. ``line``
 * must be a single line of YAML (the regex anchors to ``^`` /
 * ``$`` and won't match across newlines). The caller passes
 * ``match.line_text`` from a ``YamlSearchHit`` which is
 * single-line by construction; a future multi-line caller
 * would silently no-op rather than mask.
 *
 * ``!secret <name>`` and ``${substitution}`` values are *not*
 * masked — both carry only the name of an indirection, not the
 * credential itself. Parent-scoped keys (``key:`` under
 * ``encryption:``) aren't matched here because we have no
 * parent context for a single search-hit line.
 */
function maskSensitiveLine(line: string): string {
  // Optional ``#`` prefix matches commented-out credentials —
  // ``# password: hunter2`` is just as much a leak as the live
  // form. The leading-``#`` group is captured into ``prefix`` so
  // the masked output preserves the comment marker.
  const m = line.match(/^(\s*(?:#+\s*)?-?\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.+)$/);
  if (!m) return line;
  const [, prefix, key, valueRaw] = m;
  if (!isSensitiveKey(key)) return line;
  const value = valueRaw.trim();
  if (!value || value.startsWith("#")) return line;
  // Indirections aren't credentials — ``!secret <name>`` and
  // ``${some_substitution}`` only carry the *name* of the
  // value, not the value itself. Don't mask them.
  if (value.startsWith("!secret")) return line;
  if (value.startsWith("${")) return line;
  return `${prefix}${key}: ${MASK_PLACEHOLDER}`;
}

/**
 * Mask credential values across a contiguous block of YAML lines.
 *
 * Single-line ``maskSensitiveLine`` can't reason about parent
 * keys, so it can't mask ``key:`` under ``encryption:`` (a
 * generic ``key:`` is also used for non-sensitive button codes
 * in ``remote_receiver`` / ``remote_transmitter``). Snippet
 * blocks now carry several lines of context, which is exactly
 * the parent reasoning the editor's
 * ``findSensitiveValueRanges`` already does. This runs the
 * multi-line scanner over the joined block to catch
 * parent-scoped credentials, then falls back to the single-line
 * heuristic for what the scanner doesn't handle:
 *
 * - Commented-out credentials (``# password: hunter2``) — the
 *   scanner's ``KEY_LINE`` regex doesn't match leading ``#``.
 * - User-defined ``*_password`` / ``*_psk`` substitution keys —
 *   not in the scanner's allowlist; the suffix heuristic only
 *   lives in the single-line masker.
 *
 * Edge case: a ``key:`` line whose ``encryption:`` parent is
 * outside the block window stays unmasked (the scanner sees no
 * parent on its stack). Bounded — typical 2-line context windows
 * include the parent — and unchanged from prior behaviour.
 */
function maskSnippetBlock(lines: readonly string[]): string[] {
  if (lines.length === 0) return [];
  const out = lines.slice();
  const ranges = findSensitiveValueRanges(out.join("\n"));
  const scannerMaskedLines = new Set<number>();
  for (const range of ranges) {
    const idx = range.line - 1;
    if (idx < 0 || idx >= out.length) continue;
    const line = out[idx];
    if (range.valueFrom < 0 || range.valueTo > line.length) continue;
    // ``findSensitiveValueRanges`` skips ``!secret <name>`` (it only
    // carries the indirection name, not the credential) but doesn't
    // skip ``${substitution}`` references — they're the same shape
    // of indirection and ``maskSensitiveLine`` already preserves
    // them on single-line paths. Mirror that here so the search
    // result label and the snippet-block render agree on what stays
    // visible.
    const value = line.slice(range.valueFrom, range.valueTo).trim();
    if (value.startsWith("${")) continue;
    out[idx] =
      line.slice(0, range.valueFrom) + MASK_PLACEHOLDER + line.slice(range.valueTo);
    scannerMaskedLines.add(idx);
  }
  for (let i = 0; i < out.length; i++) {
    if (scannerMaskedLines.has(i)) continue;
    out[i] = maskSensitiveLine(out[i]);
  }
  return out;
}

/**
 * Display label for a single match row.
 *
 * Format: ``<device label> — <line text>`` where the device
 * label falls back ``friendly_name`` → ``device_name`` →
 * ``configuration``, and the line text falls back to ``line N``
 * when the matched line is just whitespace (a query like
 * ``": "`` against an empty struct value). Sensitive credentials
 * (``password:`` etc) are masked before rendering.
 */
export function yamlHitLabel(hit: YamlSearchHit, match: YamlSearchMatch): string {
  const deviceLabel = hit.friendly_name || hit.device_name || hit.configuration;
  const masked = maskSensitiveLine(match.line_text);
  const trimmed = masked.trim();
  const lineLabel = trimmed || `line ${match.line_number}`;
  return `${deviceLabel} — ${lineLabel}`;
}

/**
 * Click-target URL for a match row.
 *
 * Routes to the device editor with the ``?line=<n>`` param the
 * editor's ``_readUrlLine`` already consumes for scroll-to +
 * highlight.
 */
export function yamlHitHref(hit: YamlSearchHit, match: YamlSearchMatch): string {
  return `/device/${encodeURIComponent(hit.configuration)}?line=${match.line_number}`;
}

/**
 * Resolve the localize key for the empty-state copy.
 *
 * Tri-state on the controller's ``hits`` field:
 *
 * - ``null`` → "Searching…" (debounce pending or call in flight).
 * - ``[]`` → "No matches" (fetched, nothing matched).
 * - non-empty → empty key (caller should render rows instead).
 *
 * Returns ``null`` when there are hits to render — caller falls
 * back to its own non-empty rendering.
 */
export function yamlEmptyMessageKey(
  hits: YamlSearchHit[] | null
): "yaml_search.searching" | "yaml_search.no_matches" | null {
  if (hits === null) return "yaml_search.searching";
  if (hits.length === 0) return "yaml_search.no_matches";
  return null;
}

/** Localised empty-state copy for a YAML-search result list. */
export function yamlEmptyMessage(
  localize: LocalizeFunc,
  hits: YamlSearchHit[] | null
): string {
  const key = yamlEmptyMessageKey(hits);
  if (key) return localize(key);
  return "";
}

/**
 * Walk every (hit, match) pair across a result list.
 *
 * Used by the command palette, which renders each match as its
 * own one-line ``CommandAction`` (the keyboard-driven nav
 * surface — flat list reads better there than a grouped tree
 * because the user is keying down through results, not visually
 * scanning). Centralising the traversal means a label-format /
 * url-shape tweak lands in one place. Returns the mapped values
 * flattened in file → match order. ``null``/empty hits → empty
 * array.
 *
 * The dashboard view uses a grouped renderer instead — see
 * ``_renderYamlMode`` in ``pages/dashboard.ts`` — so this helper
 * is *only* the right shape for "I want every matching line as a
 * standalone row" callers.
 */
export function forEachYamlMatch<T>(
  hits: YamlSearchHit[] | null,
  fn: (hit: YamlSearchHit, match: YamlSearchMatch) => T
): T[] {
  if (!hits) return [];
  const out: T[] = [];
  for (const hit of hits) {
    for (const match of hit.matches) {
      out.push(fn(hit, match));
    }
  }
  return out;
}

/**
 * One contiguous ``before / matched / after`` window for the
 * dashboard's grouped snippet renderer.
 *
 * The wire shape carries each match independently with its own
 * ±N context window. When two matches in the same file land
 * close enough that their windows overlap (or are adjacent),
 * rendering them as separate snippet blocks produces a visually
 * noisy stack of duplicated context lines. This collapses any
 * such run into one block:
 *
 * - ``startLine`` / ``endLine`` are the inclusive line numbers
 *   the block covers (1-based, matching ``YamlSearchMatch.
 *   line_number``).
 * - ``lines`` is the line-by-line content for that range, in
 *   file order; the caller renders each with the line number
 *   from ``startLine + index``.
 * - ``matchedLines`` is the set of 1-based line numbers within
 *   the block that are *match* lines (highlight target). Lines
 *   in ``startLine..endLine`` that aren't in this set are
 *   pure context.
 */
export interface YamlSnippetBlock {
  startLine: number;
  endLine: number;
  lines: string[];
  matchedLines: Set<number>;
}

/**
 * Collapse a hit's ``matches`` list into one ``YamlSnippetBlock``
 * per non-overlapping run. Adjacent / overlapping windows merge.
 *
 * Lines are reconstructed from the (``before`` ⨁ ``line_text``
 * ⨁ ``after``) tuples each match carries — we don't have the
 * full file on the frontend, so the helper walks per-line
 * coordinates and picks whichever match's tuple covers each
 * line number. Where multiple matches cover the same line, the
 * content is identical (the backend slices from one source list)
 * so the order doesn't matter; this just defends against the
 * case where one match's ``after`` ends mid-overlap with the
 * next match's ``before``.
 *
 * Matches MUST already be sorted by ``line_number`` ascending —
 * the backend guarantees that.
 */
export function buildYamlSnippetBlocks(
  matches: readonly YamlSearchMatch[]
): YamlSnippetBlock[] {
  if (matches.length === 0) return [];
  // Per-line content map keyed on absolute (1-based) line number.
  // Each match contributes its before/line/after; later writes
  // for a line that's already filled are a no-op since the
  // content is identical. Masking is deferred to ``flushBlock``
  // so the parent-aware scanner can see contiguous lines as a
  // unit (a ``key:`` line under ``encryption:`` only reads as
  // sensitive when its parent is on the scanner's stack).
  const lineContent = new Map<number, string>();
  // The 1-based line numbers that are *match* lines (vs context).
  const matchLineNumbers = new Set<number>();
  for (const m of matches) {
    matchLineNumbers.add(m.line_number);
    lineContent.set(m.line_number, m.line_text);
    // ``before`` is in file order, so the line immediately
    // preceding the match is at index ``length - 1`` and walks
    // backwards from there.
    const beforeStart = m.line_number - m.before.length;
    m.before.forEach((text, i) => {
      const ln = beforeStart + i;
      if (!lineContent.has(ln)) lineContent.set(ln, text);
    });
    // ``after`` is in file order starting at line+1.
    m.after.forEach((text, i) => {
      const ln = m.line_number + 1 + i;
      if (!lineContent.has(ln)) lineContent.set(ln, text);
    });
  }
  // Walk the populated line numbers in order, splitting on gaps.
  const ordered = [...lineContent.keys()].sort((a, b) => a - b);
  const blocks: YamlSnippetBlock[] = [];
  let blockStart = ordered[0];
  let prev = ordered[0];
  const flushBlock = (start: number, end: number) => {
    const rawLines: string[] = [];
    for (let ln = start; ln <= end; ln++) {
      rawLines.push(lineContent.get(ln) ?? "");
    }
    const matchedLines = new Set<number>();
    for (let ln = start; ln <= end; ln++) {
      if (matchLineNumbers.has(ln)) matchedLines.add(ln);
    }
    blocks.push({
      startLine: start,
      endLine: end,
      lines: maskSnippetBlock(rawLines),
      matchedLines,
    });
  };
  for (let i = 1; i < ordered.length; i++) {
    const cur = ordered[i];
    if (cur !== prev + 1) {
      // Gap — close the current block and start a new one.
      flushBlock(blockStart, prev);
      blockStart = cur;
    }
    prev = cur;
  }
  flushBlock(blockStart, prev);
  return blocks;
}

/**
 * Display label for a device-section header in the grouped
 * dashboard renderer. Falls back through the same precedence as
 * ``yamlHitLabel`` — ``friendly_name`` → ``device_name`` →
 * ``configuration``.
 */
export function yamlHitDeviceLabel(hit: YamlSearchHit): string {
  return hit.friendly_name || hit.device_name || hit.configuration;
}

/**
 * Click-target URL for a snippet block — routes to the device
 * editor pinned at the block's *first match* line. The dashboard
 * makes the whole block a clickable link, so picking the first
 * match (rather than the block's start line, which is usually a
 * context line) lands the cursor on actual matched content.
 */
export function yamlSnippetBlockHref(
  hit: YamlSearchHit,
  block: YamlSnippetBlock
): string {
  // matchedLines is unsorted (it's a Set); the smallest entry
  // is what we want. Falls back to ``startLine`` for a block
  // that somehow has no matched lines — defensive only;
  // ``buildYamlSnippetBlocks`` always populates it.
  const firstMatch =
    block.matchedLines.size > 0 ? Math.min(...block.matchedLines) : block.startLine;
  return `/device/${encodeURIComponent(hit.configuration)}?line=${firstMatch}`;
}
