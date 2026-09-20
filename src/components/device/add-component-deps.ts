import type { ESPHomeAPI } from "../../api/index.js";
import {
  type ComponentCatalogEntry,
  ComponentCategory,
} from "../../api/types/components.js";
import type { ConfigEntry } from "../../api/types/config-entries.js";
import { canonicalComponentKey, hasComponentKey } from "../../util/component-presence.js";
import {
  catalogEntryToProvider,
  findReferenceCandidates,
} from "../../util/config-entry-yaml-scan.js";
import { gateAccepts, resolveDependsOn } from "../../util/config-validation.js";
import { withMergedSourcePresence } from "../../util/merged-source-presence.js";
import { providerIds } from "../../util/provides-cache.js";
import { classVerdict } from "../../util/reference-class.js";
import {
  type CatalogIndex,
  getCachedCatalogIndex,
} from "../../util/yaml-completion-catalog.js";
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
 * *component*'s dependencies minus those every referencing top-level entry
 * hides behind a resolved `depends_on` value gate. Nested entries are not
 * walked.
 */
export function liveDependencies(
  component: Pick<ComponentCatalogEntry, "dependencies" | "config_entries">,
  values: Record<string, unknown>
): string[] {
  const entries = component.config_entries;
  return (component.dependencies ?? []).filter((dep) => {
    const refs = entries.filter((e) => e.references_component === dep);
    return refs.length === 0 || !refs.every((e) => valueGateHides(e, values, entries));
  });
}

function valueGateHides(
  entry: ConfigEntry,
  values: Record<string, unknown>,
  entries: ConfigEntry[]
): boolean {
  const gate = resolveDependsOn(entry, values, undefined, entries);
  return gate != null && !gateAccepts(entry, gate);
}

/**
 * Catalog dependencies not yet satisfied by the current YAML.
 *
 * A dependency is satisfied when any of:
 *  - the presence set carries it (`ld2410:`, `i2c:`);
 *  - a dotted dep (`ota.http_request`) matches a configured platform —
 *    from the YAML scan, or from `resolvedPlatforms` on a merged-source
 *    config;
 *  - a configured platform's stem equals the dep and the dep isn't a
 *    platform domain — platform-style hubs (`atm90e32`) live under a
 *    domain (`sensor: - platform: atm90e32`), not at the top level.
 *
 * `presentComponents` is the caller's effective presence — the literal scan
 * widened via `withMergedSourcePresence` on merged-source configs; it
 * satisfies bare deps only (a bare stem must never match a dotted dep:
 * `ota.esphome` vs the always-loaded `esphome` core key). Omitted, the
 * literal scan of *yaml* is used. `resolvedPlatforms` is the dotted
 * counterpart (`loaded_platforms`), widened here rather than by callers —
 * the configured-platform scan is internal, so no caller can pre-widen it.
 */
export function findMissingDependencies(
  dependencies: readonly string[],
  yaml: string,
  presentComponents?: ReadonlySet<string>,
  resolvedPlatforms: readonly string[] = []
): string[] {
  // Most components declare no dependencies — skip the YAML scans.
  if (dependencies.length === 0) return [];
  const present = presentComponents ?? parseTopLevelComponents(yaml);
  const configured = parseConfiguredPlatforms(yaml);
  const platforms = withMergedSourcePresence(configured, yaml, resolvedPlatforms);
  // Stems stay on the literal scan: a package-supplied bare dep is already
  // covered by the widened presentComponents.
  const platformStems = new Set<string>();
  for (const id of configured) {
    const dot = id.indexOf(".");
    if (dot !== -1) platformStems.add(id.slice(dot + 1));
  }
  return dependencies.filter((dep) => {
    if (hasComponentKey(present, dep)) return false;
    if (dep.includes(".")) return !platforms.has(dep);
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
  // The provides index is keyed on the catalog's canonical platform key.
  const platform = ctx.platform ? canonicalComponentKey(ctx.platform) : undefined;
  await Promise.all(
    resolvable.map(async (dep) => {
      const providers = await providerIds(api, dep, platform, ctx.boardId ?? undefined);
      for (const id of providers) {
        if (hasComponentKey(present, id)) {
          satisfied.add(dep);
          break;
        }
      }
    })
  );
  return satisfied;
}

/**
 * Live dependencies configured only as the wrong kind: a top-level entry the
 * form asks for references the dependency with a ``references_class`` none of
 * the picker's candidates provides (hoermann_hcp needs a ``role: server``
 * modbus hub and only a client one exists). Nested entries are not walked,
 * as in ``liveDependencies``. Judges nothing until *index* has loaded.
 */
export function wrongKindDependencies(
  entries: ConfigEntry[],
  live: readonly string[],
  values: Record<string, unknown>,
  yaml: string,
  index: Pick<CatalogIndex, "components" | "byId"> | null
): string[] {
  if (!index) return [];
  const wrong = new Set<string>();
  // Most forms carry no class-restricted reference: build providers lazily.
  const providersFor = (domain: string) =>
    index.components
      .filter((c) => c.provides?.includes(domain))
      .map((c) => catalogEntryToProvider(c, domain));
  for (const entry of entries) {
    const domain = entry.references_component;
    if (!domain || !entry.references_class || entry.locked) continue;
    if (!live.includes(domain) || valueGateHides(entry, values, entries)) continue;
    if (wrong.has(domain)) continue;
    const configured = findReferenceCandidates(yaml, domain, providersFor(domain));
    if (classVerdict(yaml, configured, entry, index.byId).noneMatch) wrong.add(domain);
  }
  return [...wrong];
}

/** The banner copy family: present but unusable reads differently from absent. */
export type DepsCopy =
  | "device.bus_dependency_in_use"
  | "device.missing_dependencies"
  | "device.wrong_kind_dependency";

/**
 * The add form's dependency verdict: the net-missing deps driving the banner
 * and submit gate, plus the copy that describes them. *provided* deps (absent
 * ones a present component supplies) are dropped; a live bus dep with no
 * attachable bus (*busBlocked*) and deps present only as the wrong kind are
 * added. A lone bus-blocked dep takes the bus copy even when it is also the
 * wrong kind. Reads *index*, never loads it: the dialog awaits it before the
 * form mounts (``hydrateForSelection``).
 */
export function resolveDepVerdict(opts: {
  component: Pick<ComponentCatalogEntry, "dependencies" | "config_entries">;
  entries: ConfigEntry[];
  values: Record<string, unknown>;
  yaml: string;
  present: ReadonlySet<string>;
  resolvedPlatforms: readonly string[];
  provided: ReadonlySet<string>;
  busBlocked: string | null;
  index: Pick<CatalogIndex, "components" | "byId"> | null;
}): { deps: string[]; copy: DepsCopy } {
  const live = liveDependencies(opts.component, opts.values);
  const missing = findMissingDependencies(
    live,
    opts.yaml,
    opts.present,
    opts.resolvedPlatforms
  ).filter((d) => !opts.provided.has(d));
  const wrongKind = wrongKindDependencies(
    opts.entries,
    live,
    opts.values,
    opts.yaml,
    opts.index
  );
  const unusable = new Set(wrongKind);
  if (opts.busBlocked && live.includes(opts.busBlocked)) unusable.add(opts.busBlocked);
  const deps = [...missing, ...[...unusable].filter((d) => !missing.includes(d))];
  const copy: DepsCopy =
    deps.length === 1 && deps[0] === opts.busBlocked
      ? "device.bus_dependency_in_use"
      : deps.every((d) => wrongKind.includes(d))
        ? "device.wrong_kind_dependency"
        : "device.missing_dependencies";
  return { deps, copy };
}

/**
 * Whether the dialog's skip-the-form path must yield to the form over a
 * class-restricted reference: a dependency present only as the wrong kind
 * needs the form's callout, and with no *index* (a failed load) that can't be
 * judged, so adding would be adding blind.
 */
export function classReferenceNeedsForm(
  entries: ConfigEntry[],
  live: readonly string[],
  values: Record<string, unknown>,
  yaml: string,
  index: Pick<CatalogIndex, "components" | "byId"> | null = getCachedCatalogIndex()
): boolean {
  if (!index) return hasClassReference(entries);
  return wrongKindDependencies(entries, live, values, yaml, index).length > 0;
}

/** Whether any entry, nested ones included since seeding walks them, needs a
 *  specific id class, so adding without the catalog index would be adding blind. */
function hasClassReference(entries: ConfigEntry[]): boolean {
  return entries.some(
    (e) =>
      // A locked reference is a deliberate pin the form never asks about.
      Boolean(e.references_component && e.references_class && !e.locked) ||
      hasClassReference(e.config_entries ?? [])
  );
}
