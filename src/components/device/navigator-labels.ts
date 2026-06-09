import type { LocalizeFunc } from "../../common/localize.js";
import { getCachedComponent } from "../../util/component-name-cache.js";
import { resolveSubstitutions } from "../../util/substitutions.js";
import { type YamlSection, sectionKeyOf } from "../../util/yaml-sections.js";
import type { NavigatorBuckets } from "./navigator-buckets.js";
import type { TriggerCatalogController } from "./trigger-catalog-controller.js";

export type NavCategory = "core" | "component" | "automation";

export interface NavItemLabels {
  primary: string;
  secondary?: string;
}

/** A nav row paired with its resolved display labels. */
export interface NavRow {
  item: YamlSection;
  labels: NavItemLabels;
}

/** Inputs label resolution reads, gathered from the navigator host. */
export interface LabelContext {
  triggerCatalog: TriggerCatalogController;
  platform: string;
  deviceName: string;
  localize: LocalizeFunc;
  /** File's top-level ``substitutions:`` for expanding ``${var}`` in
   *  displayed names/ids. */
  substitutions?: Map<string, string>;
}

/**
 * Decide what to show on the two lines of a nav item.
 *
 *   line 1 (primary)   the catalog's friendly name (e.g. "GPIO Binary
 *                      Sensor") once resolved. Falls back to the raw
 *                      <domain>.<platform> (or just the domain for core
 *                      keys like `wifi`) until the cache is populated,
 *                      or when no catalog entry exists (automations).
 *   line 2 (secondary) the user-supplied `name:` if present, else the
 *                      `id:`. Hidden when neither is set or when it's
 *                      identical to the primary.
 */
export function resolveNavItemLabels(
  item: YamlSection,
  category: NavCategory,
  ctx: LabelContext
): NavItemLabels {
  const raw = sectionKeyOf(item);

  if (category === "automation") {
    return automationLabels(item, raw, ctx);
  }

  let primary = raw;
  const cached = getCachedComponent(raw, ctx.platform || undefined);
  if (cached?.name) primary = cached.name;
  if (category === "core") {
    // Core infrastructure names carry a redundant " Component" suffix
    // ("Native API Component", "Logger Component"); trim it for the nav.
    primary = primary.replace(/ Component$/, "") || primary;
  }

  // Prefer the backend-resolved node name for the esphome core section
  // so a `name: $devicename` substitution shows the expanded hostname,
  // not the raw scalar. Falls back to the raw YAML value for a
  // new/unsaved device not yet in the devices list.
  const useDeviceName = category === "core" && item.key === "esphome" && !!ctx.deviceName;
  // The backend device name is already substitution-expanded; only the
  // raw YAML scalar needs `${var}` resolved (and re-resolving the device
  // name could rewrite a legitimate `$`-shaped substring in it).
  const named = useDeviceName
    ? ctx.deviceName
    : resolveSubstitutions(item.name || item.id || "", ctx.substitutions) || undefined;
  const secondary = named && named !== primary ? named : undefined;

  return { primary, secondary };
}

/** Resolve labels for every bucket, indexed [core, components, automations]. */
export function resolveBucketLabels(
  buckets: NavigatorBuckets,
  ctx: LabelContext
): NavRow[][] {
  return [
    buckets.core.map((item) => ({
      item,
      labels: resolveNavItemLabels(item, "core", ctx),
    })),
    buckets.components.map((item) => ({
      item,
      labels: resolveNavItemLabels(item, "component", ctx),
    })),
    buckets.automations.map((item) => ({
      item,
      labels: resolveNavItemLabels(item, "automation", ctx),
    })),
  ];
}

/**
 * Two-line layout for automation entries — keeps the navigator
 * consistent with how components render (catalog name on top, instance
 * name/id below):
 *
 *   on_*: under a component  →  "Switch → Turn on" / instance name+id
 *   script entry             →  "Script"           / id
 *   interval entry           →  "Interval"         / "Every 60s"
 *
 * The catalog-derived "Switch" / "Turn on" pair comes from the
 * automation triggers catalog. While the catalog is still loading we
 * render a graceful fallback ("Switch → on_turn_on") so the navigator
 * never blanks out on first paint.
 */
function automationLabels(
  item: YamlSection,
  raw: string,
  ctx: LabelContext
): NavItemLabels {
  // Script: line 1 = "Script", line 2 = id.
  if (item.parentKey === "script") {
    const primary = ctx.localize("device.script_header_title_static");
    const secondary = resolveSubstitutions(item.id ?? raw, ctx.substitutions);
    return { primary, secondary: secondary !== primary ? secondary : undefined };
  }
  // Interval: line 1 = "Interval", line 2 = the time if known. Uses the
  // bare "automation_interval_label" key (not the longer-form "On an
  // interval" used by the kind picker) so the nav row stays scannable.
  if (item.parentKey === "interval") {
    const primary = ctx.localize("device.automation_interval_label");
    const every = item.meta?.every;
    const secondary = every
      ? ctx.localize("device.automation_interval_every_n", { time: every })
      : undefined;
    return { primary, secondary };
  }
  // Device-level (``esphome → on_boot``) — no instance to show on line 2;
  // the trigger name already identifies the automation uniquely.
  if (item.parentKey === "esphome" && item.eventKey) {
    const primary = ctx.triggerCatalog.resolveName(
      "esphome",
      item.eventKey,
      `${prettyDomain("esphome")} → ${item.eventKey}`
    );
    return { primary };
  }
  // Component-bound (``Switch → On Turn On`` resolved from the catalog;
  // "Warmtepomp" on line 2).
  if (item.parentKey && item.eventKey) {
    const fallback = `${prettyDomain(item.parentKey)} → ${item.eventKey}`;
    const primary = ctx.triggerCatalog.resolveName(
      item.parentKey,
      item.eventKey,
      fallback
    );
    const rawNamed = item.name || item.id;
    const named = rawNamed ? resolveSubstitutions(rawNamed, ctx.substitutions) : rawNamed;
    const secondary = named && named !== primary ? named : undefined;
    return { primary, secondary };
  }
  // Unscoped / unrecognised — fall back to displayLabel.
  return { primary: item.displayLabel || raw };
}

/** Capitalize a YAML domain key for display (``binary_sensor`` →
 *  ``Binary sensor``). Used for the pre-catalog fallback label and the
 *  domain subgroup headers. */
export function prettyDomain(domain: string): string {
  const spaced = domain.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
