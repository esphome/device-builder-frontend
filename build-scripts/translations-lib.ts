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
