/**
 * Helpers for the dashboard's faceted-filter toolbar.
 *
 * Each helper walks the configured-device list once and returns
 * an array of ``FacetOption`` (``{ id, name, count }``) sorted by
 * descending count then alphabetical. The dashboard uses these
 * arrays to feed ``<esphome-filter-section>`` instances for area /
 * platform / status while the labels facet uses its own
 * ``computeLabelUsage`` (since labels carry a coloured chip and
 * inline CRUD that don't fit the generic surface).
 *
 * A facet is only worth surfacing on screen when the device list
 * actually has something to filter by — a single platform across
 * every device makes the "Platform" pill pure noise. The
 * dashboard guards on ``options.length >= 1`` (and >= 2 where a
 * single-bucket facet has no informational value) before
 * rendering, so these helpers return raw arrays without further
 * trimming.
 */
import { type ConfiguredDevice, DeviceState } from "../api/types/devices.js";
import type { LocalizeFunc } from "../common/localize.js";

/** One selectable value inside a facet. */
export interface FacetOption {
  /** Opaque id surfaced through the ``facet-change`` event. */
  id: string;
  /** Display name rendered as the row label. */
  name: string;
  /** Right-edge badge count. ``0`` is a meaningful value (filters
   *  with no matching devices still render so the user can see the
   *  empty option) — pass ``-1`` to suppress the badge entirely. */
  count: number;
}

/** Locale-aware collator used to break ties when two facet
 *  options share the same device count. Computed once and reused
 *  across every helper call so the ICU instance isn't re-built on
 *  each toolbar render. */
const collator = new Intl.Collator(undefined, {
  sensitivity: "base",
  numeric: true,
});

/** Tally a (raw → count) map and turn it into a sorted FacetOption[]. */
function tallyToFacet(
  counts: Map<string, number>,
  displayName: (raw: string) => string
): FacetOption[] {
  const entries: FacetOption[] = [];
  for (const [id, count] of counts) {
    entries.push({ id, name: displayName(id), count });
  }
  // Most-populated first so the popover surfaces the bucket the
  // user is most likely scanning for. Stable alphabetical tie-
  // break keeps equal-count entries in a predictable order
  // between renders (and matches the order on the device cards /
  // table sort by name).
  entries.sort((a, b) => b.count - a.count || collator.compare(a.name, b.name));
  return entries;
}

/** Area facet — derived from each device's ``area`` field. Empty
 *  strings (the "no area declared" sentinel) are dropped so the
 *  popover doesn't show an unnamed bucket; if every device omits
 *  an area the dashboard guards on the empty-options check above
 *  and hides the pill entirely. */
export function computeAreaFacet(devices: ConfiguredDevice[]): FacetOption[] {
  const counts = new Map<string, number>();
  for (const d of devices) {
    const area = d.area?.trim();
    if (!area) continue;
    counts.set(area, (counts.get(area) ?? 0) + 1);
  }
  return tallyToFacet(counts, (raw) => raw);
}

/** Platform facet — derived from ``target_platform`` (esp32,
 *  esp8266, rp2040, …). Lower-case wire values get rendered
 *  exactly as-is; the dashboard pill carries the raw stem because
 *  that's what users see in YAML / docs and an aliasing layer
 *  would lie about what the device actually runs. */
export function computePlatformFacet(devices: ConfiguredDevice[]): FacetOption[] {
  const counts = new Map<string, number>();
  for (const d of devices) {
    const platform = d.target_platform?.trim();
    if (!platform) continue;
    counts.set(platform, (counts.get(platform) ?? 0) + 1);
  }
  return tallyToFacet(counts, (raw) => raw);
}

/** State facet — one bucket per ``DeviceState`` enum value
 *  (online / offline / unknown). Always returns three options so
 *  the popover reads consistently across reloads (a freshly-
 *  loaded dashboard with no online devices still surfaces the
 *  "Online" bucket at count 0 so the user can click it as the
 *  fleet wakes up). */
export function computeStateFacet(
  devices: ConfiguredDevice[],
  localize: LocalizeFunc
): FacetOption[] {
  const counts = new Map<string, number>();
  // Seed every enum value at zero so a missing bucket still
  // shows in the popover. Without this, devices=[] would render
  // an empty list and the facet would be unusable on a cold
  // boot.
  counts.set(DeviceState.ONLINE, 0);
  counts.set(DeviceState.OFFLINE, 0);
  counts.set(DeviceState.UNKNOWN, 0);
  for (const d of devices) {
    counts.set(d.state, (counts.get(d.state) ?? 0) + 1);
  }
  const labelKeyByState: Record<DeviceState, string> = {
    [DeviceState.ONLINE]: "dashboard.online",
    [DeviceState.OFFLINE]: "dashboard.offline",
    [DeviceState.UNKNOWN]: "dashboard.unknown",
  };
  return tallyToFacet(counts, (raw) =>
    localize(labelKeyByState[raw as DeviceState] ?? "dashboard.unknown")
  );
}

/** The two update-status buckets in canonical order — the order URL
 *  hydration normalizes ``?updates=`` into (deduped, unknown ids
 *  dropped). The *rendered* facet order is independent: ``tallyToFacet``
 *  sorts the surfaced options by count then name. */
export const UPDATE_FACET_BUCKETS = ["update_available", "modified"] as const;

type UpdateBucket = (typeof UPDATE_FACET_BUCKETS)[number];

/** Normalize arbitrary update-status ids (from the URL or the session store)
 *  to the known buckets in canonical order, deduped — so an unknown or
 *  duplicate id can't inflate the active-filter count or render duplicates. */
export function normalizeUpdateBuckets(ids: readonly string[]): string[] {
  const requested = new Set(ids);
  return UPDATE_FACET_BUCKETS.filter((b) => requested.has(b));
}

/** Each bucket's membership test — the single source of truth shared
 *  by the facet's counts here and the dashboard's row filter, so the
 *  bucket → device-field mapping isn't written twice. */
export const UPDATE_FACET_PREDICATES: Record<
  UpdateBucket,
  (device: ConfiguredDevice) => boolean
> = {
  update_available: (d) => d.update_available,
  modified: (d) => d.has_pending_changes,
};

const UPDATE_BUCKET_LABEL_KEY: Record<UpdateBucket, string> = {
  update_available: "dashboard.status_update_available",
  modified: "dashboard.status_modified",
};

/** Update-status facet — two orthogonal buckets a device can carry
 *  at once: ``update_available`` (firmware behind latest) and
 *  ``modified`` (local YAML not yet deployed). A bucket surfaces when
 *  any device matches it *or* it's currently selected — so a filter
 *  hydrated from the URL stays visible (and clearable) even after a
 *  bulk update leaves the fleet current and its count at zero. When
 *  nothing matches and nothing is selected the pill self-hides. */
export function computeUpdateFacet(
  devices: ConfiguredDevice[],
  localize: LocalizeFunc,
  selected: readonly string[] = []
): FacetOption[] {
  const counts: Record<UpdateBucket, number> = { update_available: 0, modified: 0 };
  for (const d of devices) {
    for (const id of UPDATE_FACET_BUCKETS) {
      if (UPDATE_FACET_PREDICATES[id](d)) counts[id] += 1;
    }
  }
  const selectedSet = new Set(selected);
  const surfaced = new Map<string, number>();
  for (const id of UPDATE_FACET_BUCKETS) {
    if (counts[id] > 0 || selectedSet.has(id)) surfaced.set(id, counts[id]);
  }
  return tallyToFacet(surfaced, (raw) =>
    localize(UPDATE_BUCKET_LABEL_KEY[raw as UpdateBucket] ?? "dashboard.unknown")
  );
}
