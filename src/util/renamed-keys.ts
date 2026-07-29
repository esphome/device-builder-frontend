/**
 * Session registry of legacy key spellings, hydrated from the component
 * catalog's renamed_keys maps (esphome cv.rename_key pairs extracted at
 * catalog sync). Catalog payloads record here as a side effect wherever
 * they land, so pure YAML utils can resolve accepted spellings
 * synchronously; before hydration only canonical names match.
 */

const _byComponent = new Map<string, Record<string, string>>();
const _accepted = new Map<string, string[]>();
let _generation = 0;

/** Record a component's renamed_keys map; no-op when absent or unchanged. */
export function recordRenamedKeys(
  componentId: string,
  renamed: Record<string, string> | undefined
): void {
  if (!renamed) return;
  const keys = Object.keys(renamed);
  if (keys.length === 0) return;
  const existing = _byComponent.get(componentId);
  if (
    existing &&
    Object.keys(existing).length === keys.length &&
    keys.every((k) => existing[k] === renamed[k])
  ) {
    return;
  }
  _byComponent.set(componentId, { ...renamed });
  for (const cacheKey of _accepted.keys()) {
    if (cacheKey.startsWith(`${componentId}|`)) _accepted.delete(cacheKey);
  }
  _generation++;
}

/** Every accepted spelling of canonicalKey for componentId, canonical
 *  first. Returns a cached array, stable until the next record. */
export function acceptedKeysFor(
  componentId: string,
  canonicalKey: string
): readonly string[] {
  const cacheKey = `${componentId}|${canonicalKey}`;
  let accepted = _accepted.get(cacheKey);
  if (!accepted) {
    accepted = [canonicalKey];
    const renamed = _byComponent.get(componentId);
    if (renamed) {
      for (const [old, target] of Object.entries(renamed)) {
        if (target === canonicalKey) accepted.push(old);
      }
    }
    _accepted.set(cacheKey, accepted);
  }
  return accepted;
}

/** Bumps on every registry change — fold into memo keys of consumers
 *  that cache parse results, or a pre-hydration result outlives it. */
export function renamedKeysGeneration(): number {
  return _generation;
}

/** Test helper: drop every recorded map. */
export function _clearRenamedKeys(): void {
  _byComponent.clear();
  _accepted.clear();
  _generation++;
}
