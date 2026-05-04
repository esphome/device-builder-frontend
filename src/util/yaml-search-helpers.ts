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

/**
 * Display label for a single match row.
 *
 * Format: ``<device label> — <line text>`` where the device
 * label falls back ``friendly_name`` → ``device_name`` →
 * ``configuration``, and the line text falls back to ``line N``
 * when the matched line is just whitespace (a query like
 * ``": "`` against an empty struct value).
 */
export function yamlHitLabel(hit: YamlSearchHit, match: YamlSearchMatch): string {
  const deviceLabel = hit.friendly_name || hit.device_name || hit.configuration;
  const trimmed = match.line_text.trim();
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
  return key ? localize(key) : "";
}
