import { ComponentCategory } from "../../api/types/components.js";
import {
  parseConfiguredPlatforms,
  parseTopLevelComponents,
} from "../../util/yaml-serialize.js";

// Platform domains (sensor, switch, number, ...) are satisfied only by
// a top-level block of that name, never by a same-named platform under
// another domain: a `binary_sensor: - platform: switch` mirror must not
// pass for a `switch:` dependency. Guards the stem-match branch below.
const PLATFORM_DOMAINS: ReadonlySet<string> = new Set(Object.values(ComponentCategory));

/**
 * Catalog dependencies not yet satisfied by the current YAML.
 *
 * A dependency is satisfied when any of:
 *  - a top-level block of that name exists (`ld2410:`, `i2c:`);
 *  - a dotted dep (`ota.http_request`) matches a configured platform; or
 *  - a configured platform's stem equals the dep and the dep isn't a
 *    platform domain — platform-style hubs (`atm90e32`) live under a
 *    domain (`sensor: - platform: atm90e32`), not at the top level.
 *
 * `presentComponents` may be passed precomputed to avoid re-parsing
 * the top-level blocks when the caller already has them.
 */
export function findMissingDependencies(
  dependencies: readonly string[],
  yaml: string,
  presentComponents?: ReadonlySet<string>
): string[] {
  // Most components declare no dependencies — skip the YAML scans.
  if (dependencies.length === 0) return [];
  const present = presentComponents ?? parseTopLevelComponents(yaml);
  const configured = parseConfiguredPlatforms(yaml);
  const platformStems = new Set<string>();
  for (const id of configured) {
    const dot = id.indexOf(".");
    if (dot !== -1) platformStems.add(id.slice(dot + 1));
  }
  return dependencies.filter((dep) => {
    if (present.has(dep)) return false;
    if (dep.includes(".")) return !configured.has(dep);
    if (!PLATFORM_DOMAINS.has(dep) && platformStems.has(dep)) return false;
    return true;
  });
}
