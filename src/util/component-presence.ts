// esphome#17145 renames the rp2040 platform key to rp2; a block spelled
// either way counts as the other until the catalog flips its canonical key.
const PLATFORM_KEY_ALIAS: Readonly<Record<string, string>> = {
  rp2: "rp2040",
  rp2040: "rp2",
};

/** The catalog's canonical spelling of a platform key (`rp2` → `rp2040`). */
export const canonicalComponentKey = (id: string): string =>
  id === "rp2" ? "rp2040" : id;

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
