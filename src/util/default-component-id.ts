/**
 * Auto-generate a default `id:` value for a component being added
 * via the catalog. Used by `esphome-add-component-form` to seed the
 * id field — the user can edit it before submitting.
 *
 * Naming policy:
 *   - Platform entries (id contains `.`, e.g. `switch.gpio`) and
 *     repeatable top-level blocks (`multi_conf: true`) get a numeric
 *     suffix: `switch_gpio_1`, `switch_gpio_2`, ... — users routinely
 *     add several of these, so the suffix disambiguates.
 *   - Top-level singletons (no `.`, `multi_conf: false`, e.g.
 *     `web_server`, `mdns`, `logger`, `api`) get the bare slug.
 *     There can only ever be one of them, so a `_1` suffix implies
 *     a non-existent `_2` and is misleading.
 *
 * The bare slug for a singleton can still collide with a user-defined
 * id elsewhere in the YAML (e.g. they renamed a sensor to
 * `web_server`); on collision we fall through to the suffixed path
 * so the generated id stays unique.
 */
export function generateDefaultComponentId(
  componentId: string,
  multiConf: boolean,
  existing: ReadonlySet<string>,
): string {
  const slug = componentId.replace(/\./g, "_").toLowerCase();
  const isSingleton = !multiConf && !componentId.includes(".");
  if (isSingleton && !existing.has(slug)) return slug;

  let n = 1;
  let candidate = `${slug}_${n}`;
  while (existing.has(candidate)) {
    n++;
    candidate = `${slug}_${n}`;
  }
  return candidate;
}

/**
 * Scan the YAML for every `id:` line and return the set of values.
 * Best-effort regex match — same approach the ID-reference picker
 * uses, deliberately simple (we only need a uniqueness check, not
 * a full parse).
 */
export function collectExistingIds(yaml: string): Set<string> {
  const ids = new Set<string>();
  if (!yaml) return ids;
  for (const line of yaml.split("\n")) {
    const m = line.match(/^\s+(?:-\s+)?id:\s*["']?(\S+?)["']?\s*$/);
    if (m) ids.add(m[1]);
  }
  return ids;
}
