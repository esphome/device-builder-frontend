// esphome#17145 renames the rp2040 platform key to rp2; a block spelled
// either way counts as the other. Swap the two values to flip the
// catalog's canonical key once 2026.7 is the runtime floor.
export const RP2_CANONICAL_KEY = "rp2040";
export const RP2_ALIAS_KEY = "rp2";

const PLATFORM_KEY_ALIAS: Readonly<Record<string, string>> = {
  [RP2_ALIAS_KEY]: RP2_CANONICAL_KEY,
  [RP2_CANONICAL_KEY]: RP2_ALIAS_KEY,
};

/** The catalog's canonical spelling of a platform key (`rp2` → `rp2040`). */
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
