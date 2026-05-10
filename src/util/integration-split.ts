/**
 * Split a device's `loaded_integrations` into two buckets:
 * directly-written and auto-loaded.
 *
 * The backend exposes `loaded_integrations` (every integration
 * the upstream `esphome` resolver pulled in at compile time) and
 * `directly_referenced_integrations` (the subset the user
 * literally wrote in YAML — top-level keys plus
 * `- platform: <name>` stems). The complement of the second
 * against the first is the AUTO_LOAD dependency chain (e.g.
 * `md5` from WPA2 password hashing, `mdns` from `api`,
 * `web_server_base` from `web_server`, `voltage_sampler` from
 * ADC sensors).
 *
 * Issue #422: the device-drawer's "Loaded Integrations" panel
 * was rendering the flat `loaded_integrations` list, drowning
 * the user-meaningful entries in framework noise for any
 * non-trivial config. This helper produces the per-bucket
 * lists the drawer renders inline (direct) vs collapsed
 * (indirect / auto-loaded).
 *
 * Order is stable: each bucket preserves the relative order
 * of its entries in the input `loaded_integrations` (which the
 * backend already sorts alphabetically).
 *
 * Graceful-degrade signal: when the backend couldn't resolve
 * the YAML — mid-edit drafts, missing secrets — it emits an
 * empty `directly_referenced_integrations` array. We treat
 * that as "split is unknown" (`splittable: false`) and put
 * everything into `direct` so the drawer renders the original
 * flat list under its existing header. Per-call branch in the
 * drawer's render template stays a one-liner.
 */
export interface IntegrationSplit {
  /** Integrations the user directly wrote — render inline. */
  direct: string[];
  /** Auto-loaded dependencies — render in a collapsible. */
  indirect: string[];
  /**
   * `true` when the backend supplied a non-empty
   * `directly_referenced_integrations` (so we have authority to
   * split). `false` means we fell back to "everything in
   * `direct`" as a graceful degrade — the caller should hide
   * the indirect collapsible entirely in that case.
   */
  splittable: boolean;
}

export function splitIntegrations(
  loaded: readonly string[] | null | undefined,
  directlyReferenced: readonly string[] | null | undefined,
): IntegrationSplit {
  const loadedList = loaded ?? [];
  const direct = directlyReferenced ?? [];
  if (direct.length === 0) {
    // Graceful degrade — backend doesn't know what's direct, so
    // we render everything as direct (matches the pre-#422
    // flat-list behaviour exactly).
    return { direct: [...loadedList], indirect: [], splittable: false };
  }
  const directSet = new Set(direct);
  const directBucket: string[] = [];
  const indirectBucket: string[] = [];
  for (const name of loadedList) {
    if (directSet.has(name)) {
      directBucket.push(name);
    } else {
      indirectBucket.push(name);
    }
  }
  return {
    direct: directBucket,
    indirect: indirectBucket,
    splittable: true,
  };
}
