interface CacheEntry {
  importables: readonly { name: string }[] | undefined;
  set: ReadonlySet<string>;
}

// Memoized per device-list reference: the dashboard replaces both arrays
// wholesale on every push, and the dialogs re-render far more often than
// that. The importables reference is revalidated on each hit.
const cache = new WeakMap<object, CacheEntry>();

const EMPTY: ReadonlySet<string> = new Set();

/**
 * Hostnames already taken on this network as far as the dashboard knows:
 * every configured device's esphome.name plus its YAML filename stem (the
 * backend keys creation on the stem, and the two can differ for copied
 * configs), plus every discovered-but-unadopted device's broadcast name.
 */
export function takenHostnameSet(
  devices: readonly { name: string; configuration: string }[] | undefined,
  importables?: readonly { name: string }[]
): ReadonlySet<string> {
  if (!devices) return EMPTY;
  const hit = cache.get(devices);
  if (hit && hit.importables === importables) return hit.set;
  const set = new Set(
    devices.flatMap((d) => [d.name, d.configuration.replace(/\.ya?ml$/i, "")])
  );
  for (const d of importables ?? []) set.add(d.name);
  cache.set(devices, { importables, set });
  return set;
}
