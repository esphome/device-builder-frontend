/**
 * Session registry of legacy key spellings, hydrated from the component
 * catalog's renamed_keys maps (esphome cv.rename_key pairs extracted at
 * catalog sync). Catalog payloads record here as a side effect wherever
 * they land, so pure YAML utils can resolve accepted spellings
 * synchronously; before hydration only canonical names match.
 */

const _byComponent = new Map<string, Record<string, string>>();
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
  _generation++;
}

/** Legacy spellings that map to canonicalKey for componentId. */
export function legacyKeysFor(componentId: string, canonicalKey: string): string[] {
  const renamed = _byComponent.get(componentId);
  if (!renamed) return [];
  return Object.entries(renamed)
    .filter(([, target]) => target === canonicalKey)
    .map(([old]) => old);
}

/** Bumps on every registry change — fold into memo keys of consumers
 *  that cache parse results, or a pre-hydration result outlives it. */
export function renamedKeysGeneration(): number {
  return _generation;
}

/** Test helper: drop every recorded map. */
export function _clearRenamedKeys(): void {
  _byComponent.clear();
  _generation++;
}
