/**
 * Text-level masking of credential values in YAML. The editor masks
 * visually (``sensitiveValueMaskExtension``); these helpers rewrite
 * the text itself, for any surface that renders or transmits raw
 * YAML (search snippets, crash reports, bug submissions).
 */

import {
  ALWAYS_SENSITIVE_KEYS,
  findSensitiveValueRanges,
} from "./yaml-sensitive-scan.js";

// A single dot: masked lines ride in the crash report's size-budgeted
// issue URL, where every masked character costs 9 encoded chars.
const MASK_PLACEHOLDER = "•";

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
export function maskSensitiveLine(line: string): string {
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
export function maskSensitiveLines(lines: readonly string[]): string[] {
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

/** Whole-document masking for YAML leaving the app. */
export function maskSensitiveYaml(yaml: string): string {
  return maskSensitiveLines(yaml.split("\n")).join("\n");
}
