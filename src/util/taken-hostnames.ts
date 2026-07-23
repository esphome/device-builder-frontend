// Memoized per device-list reference: the dashboard replaces the array on
// every devices push, and the dialogs re-render far more often than that.
const cache = new WeakMap<object, ReadonlySet<string>>();

/**
 * Hostnames already taken by configured devices: every esphome.name plus
 * every YAML filename stem (the backend keys creation on the stem, and the
 * two can differ for copied configs).
 */
const EMPTY: ReadonlySet<string> = new Set();

export function takenHostnameSet(
  devices: readonly { name: string; configuration: string }[] | undefined
): ReadonlySet<string> {
  if (!devices) return EMPTY;
  let set = cache.get(devices);
  if (!set) {
    set = new Set(
      devices.flatMap((d) => [d.name, d.configuration.replace(/\.ya?ml$/i, "")])
    );
    cache.set(devices, set);
  }
  return set;
}
