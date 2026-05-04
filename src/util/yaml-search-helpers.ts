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
import { ALWAYS_SENSITIVE_KEYS } from "./yaml-sensitive-scan.js";

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
  const m = line.match(
    /^(\s*(?:#+\s*)?-?\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.+)$/
  );
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
  return `${prefix}${key}: ••••••••`;
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
 * Both consumers (palette → ``CommandAction`` rows, dashboard
 * → ``<a>`` link cards) iterate ``hits → matches`` to produce
 * one row per matching line. Centralising the traversal means
 * a future shape change (e.g. grouping rows by device) lands
 * in one place. Returns the mapped values flattened in
 * file → match order. ``null``/empty hits → empty array.
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
