/**
 * Auto-generate a default `id:` value for a component being added
 * via the catalog. Used by `esphome-add-component-form` to seed the
 * id field — the user can edit it (or leave it blank) before
 * submitting.
 *
 * Naming policy:
 *   - Platform entries (id contains `.`, e.g. `switch.gpio`) and
 *     repeatable top-level blocks (`multi_conf: true`, e.g. `script`,
 *     `i2c`) get a numeric suffix: `switch_gpio_1`, `script_1`, ...
 *     Users routinely add several of these AND link to them by id
 *     from automations / lambdas / bus references, so a prefilled
 *     unique id is useful.
 *   - Top-level singletons (no `.`, `multi_conf: false`, e.g.
 *     `web_server`, `mdns`, `logger`, `api`, `ota`, `captive_portal`,
 *     `wifi`) return `null` — no id is seeded at all. These
 *     components are never referenced by id from elsewhere in the
 *     YAML, and the bare slug as an id would collide with the C++
 *     namespace of the same name in ESPHome's generated code (e.g.
 *     `id: web_server` shadows the `web_server::` namespace). The
 *     numeric-suffix form (`web_server_1`) was also wrong because
 *     it implied a non-existent `_2`. Power users who need an id
 *     for `!extend` overrides in packages can type one in.
 */
export function generateDefaultComponentId(
  componentId: string,
  multiConf: boolean,
  existing: ReadonlySet<string>,
): string | null {
  const isSingleton = !multiConf && !componentId.includes(".");
  if (isSingleton) return null;

  const slug = componentId.replace(/\./g, "_").toLowerCase();
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
