import memoizeOne from "memoize-one";

import { parseYamlSectionValues } from "./yaml-section-reader.js";

/**
 * Expand ESPHome ``${var}`` / ``$var`` references against the open
 * file's own top-level ``substitutions:`` block, for display only.
 *
 * KNOWN LIMITATION: only the open file's top-level ``substitutions:`` are
 * seen. References defined in ``!include``d files, ``packages:``, or
 * passed on the command line are left unresolved — the frontend can't
 * reach those sources without a backend round-trip.
 */

/** Parse the file's top-level ``substitutions:`` into a name→value map;
 *  empty when absent. Memoised so callers don't re-parse. */
export const parseSubstitutions = memoizeOne((yaml: string): Map<string, string> => {
  const subs = new Map<string, string>();
  if (!yaml.includes("substitutions:")) return subs;
  for (const [key, value] of Object.entries(
    parseYamlSectionValues(yaml, "substitutions")
  )) {
    // Skip nested mappings — substitution values are scalars.
    if (value != null && typeof value !== "object") subs.set(key, String(value));
  }
  return subs;
});

const SUBSTITUTION_RE = /\$\{(\w+)\}|\$(\w+)/g;

/** Expand ``${name}`` / ``$name`` in *text* against *subs*, leaving
 *  unknown refs literal. Iterates (capped) so chained substitutions
 *  resolve without looping on cycles. */
export function resolveSubstitutions(
  text: string,
  subs: Map<string, string> | undefined
): string {
  if (!subs || subs.size === 0 || !text.includes("$")) return text;
  let out = text;
  for (let pass = 0; pass < 10 && out.includes("$"); pass++) {
    const next = out.replace(SUBSTITUTION_RE, (match, braced, bare) => {
      const value = subs.get(braced ?? bare);
      return value !== undefined ? value : match;
    });
    if (next === out) break;
    out = next;
  }
  return out;
}
