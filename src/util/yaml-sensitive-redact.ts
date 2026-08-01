/**
 * Text-level masking of credential values in YAML. The editor masks
 * visually (``sensitiveValueMaskExtension``); these helpers rewrite
 * the text itself, for any surface that renders or transmits raw
 * YAML (search snippets, crash reports, bug submissions).
 */

import { RE_INLINE_COMMENT_BOUNDARY } from "./yaml-line-walker.js";
import {
  ALWAYS_SENSITIVE_KEYS,
  BLOCK_SCALAR_HEADER,
  findSensitiveValueRanges,
  SECRET_TAG_VALUE,
} from "./yaml-sensitive-scan.js";

// UI surfaces (search labels, snippets) show a full row of dots so a
// masked value reads unmistakably as a mask.
const MASK_PLACEHOLDER = "••••••••";

// Size-budgeted outputs (the crash report's prefilled issue URL) get a
// single dot: every masked character costs 9 encoded chars there.
const COMPACT_MASK_PLACEHOLDER = "•";

// Key/value line with an optional comment prefix — ``# password: hunter2``
// is just as much a leak as the live form; the captured prefix keeps the
// comment marker in the masked output. A list dash may sit on either side
// of the marker (``- # password:``, ``# - password:``). The key class
// matches the scanner's ``KEY_LINE`` (hyphens and dots allowed) so
// ``wifi-password:`` is seen.
const KEY_VALUE_LINE =
  /^(\s*(?:-\s+)?(?:#+\s*)?-?\s*)([a-zA-Z_][a-zA-Z0-9_.-]*)\s*:\s*(.+)$/;

// A comment line, split into marker and content.
const COMMENT_LINE = /^(\s*#+)\s*(.*)$/;

// User-defined credential keys: any separator before the suffix.
const SENSITIVE_KEY_SUFFIX = /[_.-](password|psk)$/i;

// Certificate/key material masked in outbound reports only: public or
// not, a PEM blob swallows the size-budgeted issue URL. UI surfaces
// keep the narrower credential-only rules.
const CERT_MATERIAL_KEY =
  /(^|[_.-])(certificate|certificate_authority|certificates|private_key|client_key)$/i;

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
  // Case-folded: reports include configs esphome would reject, so a
  // mis-capitalized `Password:` must not slip past the allowlist.
  if (ALWAYS_SENSITIVE_KEYS.has(key.toLowerCase())) return true;
  return SENSITIVE_KEY_SUFFIX.test(key);
}

function isReportSensitiveKey(key: string): boolean {
  return isSensitiveKey(key) || CERT_MATERIAL_KEY.test(key);
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
export function maskSensitiveLine(
  line: string,
  placeholder = MASK_PLACEHOLDER,
  sensitive: (key: string) => boolean = isSensitiveKey
): string {
  // A line keeping its CR matches no anchored regex here or in the
  // scanner, so CRLF input would fail open; strip and re-append.
  if (line.endsWith("\r")) {
    return `${maskSensitiveLine(line.slice(0, -1), placeholder, sensitive)}\r`;
  }
  const m = line.match(KEY_VALUE_LINE);
  if (!m) return line;
  const [, prefix, key, valueRaw] = m;
  if (!sensitive(key)) return line;
  const value = valueRaw.trim();
  if (!value) return line;
  // A comment-only value can still carry the credential
  // (``password: # hunter2``); mask the comment body, keeping the marker.
  if (value.startsWith("#")) return `${prefix}${key}: # ${placeholder}`;
  // Preserve indirections (they carry only a name) and block-scalar
  // headers (no credential of their own; rewriting breaks the YAML shape
  // while the scanner masks the body lines) — but mask any trailing
  // comment beside them.
  if (
    SECRET_TAG_VALUE.test(value) ||
    value.startsWith("${") ||
    BLOCK_SCALAR_HEADER.test(value)
  ) {
    const masked = maskCommentTail(value, placeholder);
    return masked === value ? line : `${prefix}${key}: ${masked}`;
  }
  return `${prefix}${key}: ${placeholder}`;
}

/**
 * Mask credential values across a contiguous block of YAML lines.
 *
 * Runs the parent-aware ``findSensitiveValueRanges`` scanner over
 * the joined block (catching ``key:`` under ``encryption:`` and
 * block-scalar credentials), then falls back to the single-line
 * heuristic for credential text the scanner never sees: commented-out
 * lines (its ``KEY_LINE`` regex doesn't match leading ``#``) and
 * comment-carried credential text beside skipped values.
 *
 * Edge case for partial windows (search snippets): a ``key:``
 * line whose ``encryption:`` parent falls outside the block stays
 * unmasked (the scanner sees no parent on its stack). Whole
 * documents always carry their parents, so ``maskSensitiveYaml``
 * is unaffected.
 */
export function maskSensitiveLines(
  lines: readonly string[],
  placeholder = MASK_PLACEHOLDER,
  sensitive: (key: string) => boolean = isSensitiveKey
): string[] {
  if (lines.length === 0) return [];
  // CR-terminated lines match no anchored regex here or in the scanner
  // and would fail open; mask the LF form and restore the CRs after.
  const hadCr = lines.map((l) => l.endsWith("\r"));
  const out = lines.map((l, i) => (hadCr[i] ? l.slice(0, -1) : l));
  // The predicate hands the scanner this module's wider key heuristic, so
  // heuristic-named keys get its parent-scope and block-scalar handling
  // (a bare `wifi_password: |` body would otherwise stay clear text).
  const ranges = findSensitiveValueRanges(
    { lines: out.length, line: (n) => ({ text: out[n - 1] }) },
    { sensitiveKeyPredicate: sensitive }
  );
  const scannerMaskedLines = new Set<number>();
  for (const range of ranges) {
    const idx = range.line - 1;
    const line = out[idx];
    // ``findSensitiveValueRanges`` skips ``!secret <name>`` (it only
    // carries the indirection name, not the credential) but doesn't
    // skip ``${substitution}`` references — they're the same shape
    // of indirection and ``maskSensitiveLine`` already preserves
    // them on single-line paths. Mirror that here so every masking
    // path agrees on what stays visible.
    const value = line.slice(range.valueFrom, range.valueTo).trim();
    if (value.startsWith("${")) continue;
    out[idx] =
      line.slice(0, range.valueFrom) +
      placeholder +
      maskCommentTail(line.slice(range.valueTo), placeholder);
    scannerMaskedLines.add(idx);
  }
  for (let i = 0; i < out.length; i++) {
    if (scannerMaskedLines.has(i)) continue;
    const line = out[i];
    out[i] = maskSensitiveLine(line, placeholder, sensitive);
    // A commented-out block scalar hides the credential on the following
    // comment lines, which carry no key for the per-line fallback; mask
    // the bodies indented past the header's key column, mirroring how the
    // scanner terminates a real block scalar. Marker-adjacent content
    // (``#hunter2``, no space) is always treated as body: its column is
    // ambiguous, and skipping it would leak.
    const headerColumn = commentedBlockHeaderColumn(line, sensitive);
    if (headerColumn === -1) continue;
    for (let j = i + 1; j < out.length; j++) {
      const m = out[j].match(COMMENT_LINE);
      if (!m) break;
      if (!m[2]) continue;
      const contentColumn = out[j].length - m[2].length;
      if (contentColumn > m[1].length && contentColumn <= headerColumn) break;
      out[j] = `${m[1]} ${placeholder}`;
    }
  }
  return out.map((l, i) => (hadCr[i] ? `${l}\r` : l));
}

// The key's column within a commented sensitive block-scalar header
// (dash-tolerant, via the same KEY_VALUE_LINE that recognizes it), or
// -1 when the line isn't one.
function commentedBlockHeaderColumn(
  line: string,
  sensitive: (key: string) => boolean
): number {
  const m = line.match(KEY_VALUE_LINE);
  return m !== null &&
    m[1].includes("#") &&
    sensitive(m[2]) &&
    BLOCK_SCALAR_HEADER.test(m[3].trim())
    ? m[1].length
    : -1;
}

// A trailing comment beside a masked or preserved value can carry the
// credential itself; mask its body, keeping the marker and spacing.
// Returns the input unchanged when it carries no comment.
function maskCommentTail(tail: string, placeholder: string): string {
  const boundary = tail.search(RE_INLINE_COMMENT_BOUNDARY);
  if (boundary === -1) return tail;
  const hash = tail.indexOf("#", boundary);
  return `${tail.slice(0, hash)}# ${placeholder}`;
}

/** Whole-document masking for YAML leaving the app. */
export function maskSensitiveYaml(yaml: string): string {
  return maskSensitiveLines(
    yaml.split("\n"),
    COMPACT_MASK_PLACEHOLDER,
    isReportSensitiveKey
  ).join("\n");
}
