import type { ESPHomeAPI } from "../../api/index.js";
import { ComponentCategory } from "../../api/types/components.js";
import { providerIds } from "../../util/provides-cache.js";
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

/**
 * Of the deps `findMissingDependencies` still flags, the subset a present
 * top-level component already *provides* under a different name.
 *
 * A `bk72xx:` block provides `libretiny` (the `output.libretiny_pwm` dep);
 * a `tca9548a:` / `usb_uart:` block provides `i2c` / `uart`. The
 * literal-name scan can't tie provider to dep, so each still-missing dep is
 * matched against its providers from the `provides` index. Lookups are
 * cached for the process lifetime (`providerIds`), so re-resolving on every
 * YAML change costs one query per interface total; empty `missing`
 * short-circuits with no round trip.
 */
export async function depsSatisfiedByProvides(
  api: ESPHomeAPI,
  missing: readonly string[],
  present: ReadonlySet<string>,
  ctx: { platform?: string | null; boardId?: string | null }
): Promise<ReadonlySet<string>> {
  const satisfied = new Set<string>();
  // Dotted `<domain>.<platform>` deps are resolved by `findMissingDependencies`
  // and never key the bare-id `provides` index, so a query for them always
  // comes back empty — skip them rather than pay the round trip.
  const resolvable = missing.filter((dep) => !dep.includes("."));
  if (resolvable.length === 0) return satisfied;
  await Promise.all(
    resolvable.map(async (dep) => {
      const providers = await providerIds(
        api,
        dep,
        ctx.platform ?? undefined,
        ctx.boardId ?? undefined
      );
      for (const id of providers) {
        if (present.has(id)) {
          satisfied.add(dep);
          break;
        }
      }
    })
  );
  return satisfied;
}
