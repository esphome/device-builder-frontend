/**
 * Session registry of legacy key spellings, hydrated from the component
 * catalog's renamed_keys maps (esphome cv.rename_key pairs extracted at
 * catalog sync). Catalog payloads record here as a side effect wherever
 * they land, so pure YAML utils can resolve accepted spellings
 * synchronously; before hydration only canonical names match.
 */

const _byComponent = new Map<string, Record<string, string>>();
const _accepted = new Map<string, string[]>();
const _listeners = new Set<() => void>();
let _generation = 0;

function _bumpGeneration(): void {
  _generation++;
  // Isolate each listener so a throwing subscriber can't skip the rest
  // or surface as a caller failure.
  for (const listener of _listeners) {
    try {
      listener();
    } catch (err) {
      console.error("renamed-keys listener threw", err);
    }
  }
}

/** Store one map without notifying; reports whether anything changed. */
function _record(
  componentId: string,
  renamed: Record<string, string> | undefined
): boolean {
  if (!renamed) return false;
  const keys = Object.keys(renamed);
  if (keys.length === 0) return false;
  const existing = _byComponent.get(componentId);
  if (
    existing &&
    Object.keys(existing).length === keys.length &&
    keys.every((k) => existing[k] === renamed[k])
  ) {
    return false;
  }
  _byComponent.set(componentId, { ...renamed });
  for (const cacheKey of _accepted.keys()) {
    if (cacheKey.startsWith(`${componentId}|`)) _accepted.delete(cacheKey);
  }
  return true;
}

/** Record a component's renamed_keys map; no-op when absent or unchanged. */
export function recordRenamedKeys(
  componentId: string,
  renamed: Record<string, string> | undefined
): void {
  if (_record(componentId, renamed)) _bumpGeneration();
}

/** Record a whole catalog payload with a single generation bump. */
export function recordRenamedKeysBatch(
  entries: Iterable<readonly [string, Record<string, string> | undefined]>
): void {
  let changed = false;
  for (const [componentId, renamed] of entries) {
    changed = _record(componentId, renamed) || changed;
  }
  if (changed) _bumpGeneration();
}

/** Notify on every registry change, mirroring the sibling session
 *  caches so hosts re-render when hydration lands. */
export function subscribeRenamedKeys(listener: () => void): () => void {
  _listeners.add(listener);
  return () => _listeners.delete(listener);
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
  _bumpGeneration();
}
