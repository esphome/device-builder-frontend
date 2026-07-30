import { isValidEspHomeId, normalizeEspHomeId } from "./esphome-id.js";
import { isPlatformComponentId } from "./featured-id.js";
import { collectInstanceScalars, readInstanceScalar } from "./yaml-instance-scalars.js";
import { YamlRawValue } from "./yaml-serialize.js";

// Keys that name an ESPHome id: `id` itself, or an `<prefix>_id` field. The
// underscore keeps lookalikes (`valid`, `uuid`) out.
const ID_NAMING_KEY_RE = /^(?:[a-z0-9_]+_)?id$/;
const ID_NAMING_LINE_RE = /^\s+(?:-\s+)?((?:[a-z0-9_]+_)?id):/;

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

  return generateUniqueId(componentId, existing);
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
  return generateUniqueId(listKey, existing);
}

/** Scan the YAML for every `id:` line and return the set of values. */
export function collectExistingIds(yaml: string): Set<string> {
  return collectInstanceScalars(yaml, "id");
}

/**
 * Every value under an id-naming key (`id`, `*_id`) in *yaml*.
 *
 * Wider than `collectExistingIds` because a generated id must clear ids
 * declared under another key too: tca9548a's `channels[].bus_id` mints from
 * the same base slug as usb_uart's `channels[].id`. References land in the
 * pool as well, which only ever bumps the numeric suffix.
 */
export function collectTakenIds(yaml: string): Set<string> {
  const taken = new Set<string>();
  for (const line of yaml.split("\n")) {
    const key = line.match(ID_NAMING_LINE_RE)?.[1];
    if (key === undefined) continue;
    const value = readInstanceScalar(line, key);
    if (value !== null) taken.add(value);
  }
  return taken;
}

/** Add every id-naming scalar in the form-values tree *node* to *out*. */
export function addTakenIdsFromValues(node: unknown, out: Set<string>): void {
  // Arrays fall through the same branch — their numeric keys can't name an id.
  if (!node || typeof node !== "object" || node instanceof YamlRawValue) return;
  for (const [key, value] of Object.entries(node)) {
    if (typeof value === "string" && value && ID_NAMING_KEY_RE.test(key)) out.add(value);
    addTakenIdsFromValues(value, out);
  }
}

// Slug *raw* into a valid ESPHome id, then walk a numeric suffix until it
// clears *existing*. A normalised slug can only be invalid by leading with a
// digit; unlike user-typed input it has no mid-typing UX to preserve, so it
// takes an underscore prefix rather than being left invalid.
function generateUniqueId(raw: string, existing: ReadonlySet<string>): string {
  const slug = normalizeEspHomeId(raw.toLowerCase());
  const base = isValidEspHomeId(slug) ? slug : `_${slug}`;
  let n = 1;
  while (existing.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}
