// Canonical and accepted-alias spellings of the RP2 platform key
// (esphome#17145 rename); a canonical-key flip starts by swapping these.
export const RP2_CANONICAL_KEY = "rp2040";
export const RP2_ALIAS_KEY = "rp2";

/** ESPHome target-platform section keys that carry board config (no `host`). */
export const TARGET_PLATFORM_KEYS: ReadonlySet<string> = new Set([
  "esp32",
  "esp8266",
  RP2_CANONICAL_KEY,
  RP2_ALIAS_KEY,
  "bk72xx",
  "rtl87xx",
  "ln882x",
  "nrf52",
]);

const PLATFORM_KEY_ALIAS: Readonly<Record<string, string>> = {
  [RP2_ALIAS_KEY]: RP2_CANONICAL_KEY,
  [RP2_CANONICAL_KEY]: RP2_ALIAS_KEY,
};

/** Fold the non-canonical RP2 spelling onto the catalog's canonical key. */
export const canonicalComponentKey = (id: string): string =>
  id === RP2_ALIAS_KEY ? RP2_CANONICAL_KEY : id;

/** Whether `present` holds `id` under either alias spelling. */
export function hasComponentKey(present: ReadonlySet<string>, id: string): boolean {
  if (present.has(id)) return true;
  const alias = PLATFORM_KEY_ALIAS[id];
  return alias !== undefined && present.has(alias);
}

/**
 * Whether a component id is already configured in the YAML's present set.
 *
 * A platform-variant id (`time.homeassistant`) matches a configured platform;
 * a bare id (`ethernet`, `wifi`) matches a top-level block.
 */
export function isComponentPresent(
  id: string,
  present: ReadonlySet<string>,
  presentPlatforms: ReadonlySet<string>
): boolean {
  return id.includes(".") ? presentPlatforms.has(id) : hasComponentKey(present, id);
}
