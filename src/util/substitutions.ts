/**
 * Expand ESPHome ``${var}`` / ``$var`` references against the open
 * file's own top-level ``substitutions:`` block, for display only.
 *
 * KNOWN LIMITATION: only the open file's top-level ``substitutions:`` are
 * seen. References defined in ``!include``d files, ``packages:``, or
 * passed on the command line are left unresolved — the frontend can't
 * reach those sources without a backend round-trip.
 */

/** Strip surrounding quotes / an inline ``# comment`` from a raw scalar. */
function rawScalar(raw: string): string {
  const v = raw.trim();
  if (v[0] === '"' || v[0] === "'") {
    const end = v.indexOf(v[0], 1);
    if (end > 0) return v.slice(1, end);
  }
  const comment = v.search(/\s#/);
  return (comment >= 0 ? v.slice(0, comment) : v).trim();
}

/**
 * Parse the file's top-level ``substitutions:`` into a name→value map;
 * empty when absent. Values are kept as their raw scalar text — ESPHome
 * treats substitutions as strings, so ``enabled: yes`` stays ``yes``
 * rather than coercing to ``true``.
 */
export function parseSubstitutions(yaml: string): Map<string, string> {
  const subs = new Map<string, string>();
  if (!yaml.includes("substitutions:")) return subs;
  let inBlock = false;
  for (const line of yaml.split("\n")) {
    if (!inBlock) {
      if (/^substitutions:\s*(#.*)?$/.test(line)) inBlock = true;
      continue;
    }
    if (/^\s*(#.*)?$/.test(line)) continue; // blank / comment-only
    if (!/^\s/.test(line)) break; // dedent to a new top-level key
    const m = line.match(/^\s+(\w+):\s*(.*)$/);
    if (m) subs.set(m[1], rawScalar(m[2]));
  }
  return subs;
}

// Bare ``$name`` must start with a letter/underscore so a literal like
// ``$5.00`` isn't mistaken for a reference; braces make ``${...}`` explicit.
const SUBSTITUTION_RE = /\$\{(\w+)\}|\$([a-zA-Z_]\w*)/g;
const SUBSTITUTION_REF_RE = /\$\{\w+\}|\$[a-zA-Z_]\w*/;

/** True when *text* contains a ``${var}`` / ``$var`` reference. */
export function hasSubstitutionReference(text: string): boolean {
  return SUBSTITUTION_REF_RE.test(text);
}

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
