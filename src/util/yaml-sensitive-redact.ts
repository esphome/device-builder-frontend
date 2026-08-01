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

// UI surfaces (search labels, snippets) show a full row of dots so a
// masked value reads unmistakably as a mask.
const MASK_PLACEHOLDER = "••••••••";

// Size-budgeted outputs (the crash report's prefilled issue URL) get a
// single dot: every masked character costs 9 encoded chars there.
const COMPACT_MASK_PLACEHOLDER = "•";

// Key/value line with an optional comment prefix — ``# password: hunter2``
// is just as much a leak as the live form; the captured prefix keeps the
// comment marker in the masked output.
const KEY_VALUE_LINE = /^(\s*(?:#+\s*)?-?\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.+)$/;

/**
 * True when *key* names a credential whose value must not leave
 * the app in clear text. Combines two sources:
 *
 * - The shared ``ALWAYS_SENSITIVE_KEYS`` allowlist from the
 *   editor's mask scan (``password``/``ap_password`` etc).
 * - A ``*_password`` / ``*_psk`` suffix heuristic so
 *   user-defined substitution keys (``wifi_password:`` under a
 *   top-level ``substitutions:`` block, or any other place
 *   someone names their own credential field) are masked too.
 *
 * The heuristic is deliberately a touch wider than the scan's
 * allowlist. Over-masking is a cosmetic blemish; under-masking
 * leaks a credential.
 */
function isSensitiveKey(key: string): boolean {
  if (ALWAYS_SENSITIVE_KEYS.has(key)) return true;
  return /_(password|psk)$/i.test(key);
}

/**
 * Strip the inline credential value from a single line of YAML.
 *
 * ``line`` must be one line (the regex anchors to ``^`` / ``$``
 * and won't match across newlines; a multi-line input silently
 * no-ops rather than masks). ``!secret <name>`` and
 * ``${substitution}`` values are *not* masked — both carry only
 * the name of an indirection, not the credential itself.
 * Parent-scoped keys (``key:`` under ``encryption:``) aren't
 * matched here because a single line carries no parent context;
 * use ``maskSensitiveLines`` when the surrounding lines exist.
 */
export function maskSensitiveLine(line: string, placeholder = MASK_PLACEHOLDER): string {
  const m = line.match(KEY_VALUE_LINE);
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
  return `${prefix}${key}: ${placeholder}`;
}

/**
 * Mask credential values across a contiguous block of YAML lines.
 *
 * Runs the parent-aware ``findSensitiveValueRanges`` scanner over
 * the joined block (catching ``key:`` under ``encryption:`` and
 * block-scalar credentials), then falls back to the single-line
 * heuristic for what the scanner doesn't handle:
 *
 * - Commented-out credentials (``# password: hunter2``) — the
 *   scanner's ``KEY_LINE`` regex doesn't match leading ``#``.
 * - User-defined ``*_password`` / ``*_psk`` substitution keys —
 *   not in the scanner's allowlist; the suffix heuristic only
 *   lives in the single-line masker.
 *
 * Edge case for partial windows (search snippets): a ``key:``
 * line whose ``encryption:`` parent falls outside the block stays
 * unmasked (the scanner sees no parent on its stack). Whole
 * documents always carry their parents, so ``maskSensitiveYaml``
 * is unaffected.
 */
export function maskSensitiveLines(
  lines: readonly string[],
  placeholder = MASK_PLACEHOLDER
): string[] {
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
    // them on single-line paths. Mirror that here so every masking
    // path agrees on what stays visible.
    const value = line.slice(range.valueFrom, range.valueTo).trim();
    if (value.startsWith("${")) continue;
    out[idx] = line.slice(0, range.valueFrom) + placeholder + line.slice(range.valueTo);
    scannerMaskedLines.add(idx);
  }
  for (let i = 0; i < out.length; i++) {
    if (scannerMaskedLines.has(i)) continue;
    out[i] = maskSensitiveLine(out[i], placeholder);
  }
  return out;
}

/** Whole-document masking for YAML leaving the app. */
export function maskSensitiveYaml(yaml: string): string {
  return maskSensitiveLines(yaml.split("\n"), COMPACT_MASK_PLACEHOLDER).join("\n");
}
