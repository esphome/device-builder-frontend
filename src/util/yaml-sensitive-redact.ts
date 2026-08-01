/**
 * Text-level masking of credential values in YAML. The editor masks
 * visually (``sensitiveValueMaskExtension``); these helpers rewrite
 * the text itself, for any surface that renders or transmits raw
 * YAML (search snippets, crash reports, bug submissions).
 *
 * Detection lives in ``findSensitiveValueRanges`` — this module only
 * chooses the key predicate and the placeholder per surface, and
 * applies the placeholder to the ranges the scanner emits.
 */

import { findSensitiveValueRanges } from "./yaml-sensitive-scan.js";

// UI surfaces (search labels, snippets) show a full row of dots so a
// masked value reads unmistakably as a mask.
const MASK_PLACEHOLDER = "••••••••";

// Size-budgeted outputs (the crash report's prefilled issue URL) get a
// single dot: every masked character costs 9 encoded chars there.
const COMPACT_MASK_PLACEHOLDER = "•";

// User-defined credential keys: any separator before the suffix.
const SENSITIVE_KEY_SUFFIX = /[_.-](password|psk)$/i;

// Certificate/key material masked in outbound reports only: public or
// not, a PEM blob swallows the size-budgeted issue URL. UI surfaces
// keep the narrower credential-only rules.
const CERT_MATERIAL_KEY =
  /(^|[_.-])(certificate|certificate_authority|certificates|private_key|client_key)$/i;

// Report-only suffix widening for idiomatic substitution names
// (`wifi_pass`, `api_token`, `my_secret`): over-masking costs nothing
// in the report, and the preserved `${...}` reference site would
// otherwise hide the leak. Deliberately not bare `key` — that would
// swallow `remote_receiver`'s button codes.
const REPORT_SENSITIVE_KEY_SUFFIX = /[_.-](pass|secret|token)$/i;

// The scanner capabilities every text-masking surface opts into: the
// editor's visual mask deliberately does not (comments stay visible
// while editing; `${...}` values mask there).
const REDACT_SCAN_OPTIONS = {
  scanCommented: true,
  emitCommentSpans: true,
  skipSubstitutionRefs: true,
} as const;

/**
 * Strip credential values from a single line of YAML.
 *
 * The single-line window carries no parent context, so parent-scoped
 * keys (``key:`` under ``encryption:``) aren't masked here; use
 * ``maskSensitiveLines`` when the surrounding lines exist.
 */
export function maskSensitiveLine(
  line: string,
  placeholder = MASK_PLACEHOLDER,
  sensitive: (key: string) => boolean = isSensitiveKey
): string {
  return maskSensitiveLines([line], placeholder, sensitive)[0];
}

/**
 * Mask credential values across a contiguous block of YAML lines,
 * including commented-out credentials and comment-carried credential
 * text beside masked or preserved values.
 *
 * Edge case for partial windows (search snippets): a ``key:`` line
 * whose ``encryption:`` parent falls outside the block stays unmasked
 * (the scanner sees no parent on its stack). Whole documents always
 * carry their parents, so ``maskSensitiveYaml`` is unaffected.
 */
export function maskSensitiveLines(
  lines: readonly string[],
  placeholder = MASK_PLACEHOLDER,
  sensitive: (key: string) => boolean = isSensitiveKey
): string[] {
  if (lines.length === 0) return [];
  const out = lines.slice();
  const ranges = findSensitiveValueRanges(
    { lines: out.length, line: (n) => ({ text: out[n - 1] }) },
    { ...REDACT_SCAN_OPTIONS, sensitiveKeyPredicate: sensitive }
  );
  // Right-to-left so a line's earlier range offsets stay valid after a
  // later range on the same line is replaced. The scanner normalizes
  // trailing CRs itself, and its columns are valid in the CR-bearing
  // originals — the CR is line-final and past every range.
  for (let r = ranges.length - 1; r >= 0; r--) {
    const { line, valueFrom, valueTo } = ranges[r];
    const idx = line - 1;
    out[idx] = out[idx].slice(0, valueFrom) + placeholder + out[idx].slice(valueTo);
  }
  return out;
}

/** Whole-document masking for YAML leaving the app. */
export function maskSensitiveYaml(yaml: string): string {
  return maskSensitiveLines(
    yaml.split("\n"),
    COMPACT_MASK_PLACEHOLDER,
    isReportSensitiveKey
  ).join("\n");
}

/**
 * Additive key heuristic handed to the scanner, which already owns the
 * allowlists, case folding, and parent scoping: user-defined
 * ``*_password`` / ``*_psk`` substitution names. Over-masking is a
 * cosmetic blemish; under-masking leaks a credential.
 */
function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_SUFFIX.test(key);
}

function isReportSensitiveKey(key: string): boolean {
  return (
    isSensitiveKey(key) ||
    CERT_MATERIAL_KEY.test(key) ||
    REPORT_SENSITIVE_KEY_SUFFIX.test(key)
  );
}
