import { normalizeEspHomeId } from "./esphome-id.js";
import { isPlatformComponentId } from "./featured-id.js";
import { collectInstanceScalars } from "./yaml-instance-scalars.js";

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
  existing: ReadonlySet<string>
): string | null {
  // A featured wrap judges singleton-ness by `multiConf` alone — the dotted
  // form would otherwise always read as a platform entry and a
  // single-instance wrap (ethernet, wifi) would wrongly get an id.
  const isSingleton = !multiConf && !isPlatformComponentId(componentId);
  if (isSingleton) return null;

  return uniquifyId(slugifyId(componentId), existing);
}

/**
 * Auto-generate an `id:` value for a new nested-list row whose schema
 * requires one (e.g. `voice_assistant.microphone` items): the list key
 * plus a numeric suffix, unique against *existing*.
 */
export function generateNestedItemId(
  listKey: string,
  existing: ReadonlySet<string>
): string {
  return uniquifyId(slugifyId(listKey), existing);
}

/** Scan the YAML for every `id:` line and return the set of values. */
export function collectExistingIds(yaml: string): Set<string> {
  return collectInstanceScalars(yaml, "id");
}

// Normalise to a valid ESPHome id ([a-zA-Z_][a-zA-Z0-9_]*): a featured
// board id carries dashes (`esp32-poe-iso`) which dots-only wouldn't strip.
// Generated ids are lowercased by convention before the shared reshape, and
// a digit-leading slug gets an underscore prefix — unlike user-typed input,
// a generated id has no mid-typing UX to preserve.
function slugifyId(raw: string): string {
  const slug = normalizeEspHomeId(raw.toLowerCase());
  return /^[a-z_]/.test(slug) ? slug : `_${slug}`;
}

function uniquifyId(slug: string, existing: ReadonlySet<string>): string {
  let n = 1;
  let candidate = `${slug}_${n}`;
  while (existing.has(candidate)) {
    n++;
    candidate = `${slug}_${n}`;
  }
  return candidate;
}
