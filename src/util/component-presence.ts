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
  return id.includes(".") ? presentPlatforms.has(id) : present.has(id);
}
