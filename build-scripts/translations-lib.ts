// Pure, side-effect-free helpers for the translations CLI. Kept in their
// own module (no Node globals, no top-level side effects) so they can be
// unit-tested without importing the script's `main()`, which runs on
// import, and so the type-checker can cover them via the test graph.

// Base language. Its file (en.json) is the in-repo source of truth: it is
// the only committed translation file and is never overwritten by a
// download.
export const BASE_LANGUAGE = "en";

// Canonicalize a locale stem to a BCP 47 tag. Lokalise emits underscore-
// separated ISO codes (`zh_CN`, `pt_BR`); hyphenate then canonicalize via
// `Intl` so both the written filename and any downstream `Intl.*` consumer
// get a valid tag (`zh-CN`, `pt-BR`). Falls back to the hyphenated form for
// anything `Intl` rejects, so this never throws.
export function toBcp47(stem: string): string {
  const hyphenated = stem.replace(/_/g, "-");
  try {
    return Intl.getCanonicalLocales(hyphenated)[0] ?? hyphenated;
  } catch {
    return hyphenated;
  }
}

// Derive the canonical locale code from a zip entry name (`fr.json`,
// `nested/zh_CN.json`), or null when the entry isn't a JSON file. Keeps the
// written filename in the repo's BCP 47 hyphenated convention regardless of
// the separator Lokalise used.
export function localeFromZipEntry(name: string): string | null {
  if (!name.endsWith(".json")) {
    return null;
  }
  const stem = name
    .split("/")
    .pop()!
    .replace(/\.json$/, "");
  return toBcp47(stem);
}

// Read a `--flag value` or `--flag=value` option out of argv. Returns
// undefined when the flag is absent.
export function flagValue(args: string[], name: string): string | undefined {
  const inline = args.find((a) => a.startsWith(`${name}=`));
  if (inline) {
    return inline.slice(name.length + 1);
  }
  const idx = args.indexOf(name);
  return idx === -1 ? undefined : args[idx + 1];
}

type Messages = Record<string, unknown>;

// Flatten a nested messages object to a map of dot-joined leaf key → string
// value. Non-string leaves are skipped so they never count as translatable.
function flattenMessages(
  obj: Messages,
  prefix = "",
  out: Map<string, string> = new Map()
): Map<string, string> {
  for (const [key, value] of Object.entries(obj)) {
    if (value !== null && typeof value === "object") {
      flattenMessages(value as Messages, `${prefix}${key}.`, out);
    } else if (typeof value === "string") {
      out.set(`${prefix}${key}`, value);
    }
  }
  return out;
}

// The manifest generator measures every locale against the same English base
// object, so flatten it once per base and reuse the result. Keyed weakly so a
// transient base doesn't pin its leaf map in memory. Deterministic, so this
// stays referentially transparent.
const baseLeavesCache = new WeakMap<Messages, Map<string, string>>();

function flattenBase(base: Messages): Map<string, string> {
  let leaves = baseLeavesCache.get(base);
  if (leaves === undefined) {
    leaves = flattenMessages(base);
    baseLeavesCache.set(base, leaves);
  }
  return leaves;
}

// Percentage (integer 0–100) of the English source's leaf keys that carry a
// non-empty value in `locale`. Mirrors how the runtime overlays a locale on
// the English base (src/common/localize.ts): a key counts as translated when
// the locale supplies any non-empty string for it, even one identical to
// English (proper nouns, shared terms — Lokalise counts those too). Keys the
// locale still carries but English has dropped (stale Lokalise entries) don't
// count. Never rounds a partial locale up to 100%, and any locale with at
// least one translated key reads ≥1% so a barely-started language isn't shown
// as a flat 0%.
//
// The language-manifest generator (build-scripts/gen-language-manifest.cjs)
// `require`s this module directly — native type stripping plus require(esm)
// make that work from CommonJS — so this unit-tested implementation is the
// only copy.
export function localeCompleteness(base: Messages, locale: Messages): number {
  const baseLeaves = flattenBase(base);
  const total = baseLeaves.size;
  if (total === 0) {
    return 100;
  }
  const localeLeaves = flattenMessages(locale);
  let translated = 0;
  for (const key of baseLeaves.keys()) {
    const value = localeLeaves.get(key);
    if (value !== undefined && value.length > 0) {
      translated += 1;
    }
  }
  if (translated >= total) {
    return 100;
  }
  if (translated === 0) {
    return 0;
  }
  return Math.min(99, Math.max(1, Math.round((translated / total) * 100)));
}

export type DownloadSource = "lokalise" | "release";

// Resolve the `download --source`. Absent flag defaults to "lokalise", but
// a present-but-valueless or unknown `--source` is an error rather than a
// silent fallback — so `download -- --source` (no value) or a typo fails
// fast instead of quietly running against Lokalise.
export function resolveDownloadSource(args: string[]): DownloadSource {
  const present = args.some((a) => a === "--source" || a.startsWith("--source="));
  if (!present) {
    return "lokalise";
  }
  const value = flagValue(args, "--source");
  if (value === "lokalise" || value === "release") {
    return value;
  }
  throw new Error(
    `--source must be 'lokalise' or 'release' (${value ? `got '${value}'` : "no value given"}).`
  );
}
