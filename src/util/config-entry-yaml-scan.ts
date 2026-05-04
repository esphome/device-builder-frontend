/**
 * YAML scanning helpers used by the ConfigEntry form to (a) detect pin
 * conflicts between sections and (b) discover ID references for the
 * id-reference picker. These are deliberately tiny, line-based scans —
 * a full YAML parse is overkill for the few keys we care about, and the
 * source is the user's working YAML which may be mid-edit.
 *
 * The form re-renders on every keystroke (live `yaml` prop is a
 * dependency of pin / id pickers), so both scans are memoised
 * single-entry by `yaml` reference. Re-renders that don't change the
 * yaml return cached results; an actual yaml change re-scans once.
 * Linear scans on the typical config (<200 lines) are sub-millisecond
 * even without the cache, but memoisation collapses the worst case
 * (paste a multi-thousand-line config, type into a field) from
 * O(N) per keystroke to O(1).
 */

/**
 * Map every `GPIO<n>` reference in the YAML to the top-level domain
 * that owns it (e.g. `{ 4: "switch", 5: "binary_sensor" }`). When
 * `excludeFromLine`/`excludeToLine` are provided the lines in that
 * (inclusive) 1-indexed range are skipped — used by the section
 * editor so a pin selector doesn't flag the user's *own* pin as
 * already in use.
 */
/**
 * Single-entry memo with reference-equality keys. The hot path
 * is the form re-rendering on every keystroke into the YAML
 * pane: the live `yaml` prop is a dependency of the pin and
 * id-reference renderers, and the section editor's exclude
 * range / domain are stable across that same edit window — so
 * a paste-then-type workflow gets cache hits on every keystroke.
 *
 * Reference equality on `yaml` rather than a composite-string
 * key: the parent (`pages/device.ts::_yaml`) only reassigns
 * the string when the user types, so identical reads share
 * the same identity. A composite-string key would itself be
 * O(N) to build on every call — defeating most of the point.
 *
 * **Load-bearing:** `pages/device.ts` must keep `_yaml`'s
 * string identity stable across renders that don't change the
 * content. If a future refactor reconstructs the string each
 * render (template literal, `String(...)`, JSON round-trip),
 * every call becomes a cache miss and the optimisation
 * silently degrades to a no-op.
 *
 * Wrapping the state in a small factory keeps the reset list
 * (`_clearScanMemos`) single-source — adding a third memo just
 * means a new `createScanMemo<K, V>()` line, not editing two
 * places.
 */
/**
 * `equals` is bound at factory time, not per-call: a single
 * `pinMemo` always uses one key-equality contract, so a future
 * caller can't silently flip cache semantics by passing a
 * different `equals` to `.get()`. The factory holds it as a
 * closed-over private.
 *
 * `undefined` is the unset sentinel — the cache always misses
 * before the first `set()`. That precludes using `undefined`
 * as a legitimate cache key, which is fine because both memos
 * here use object keys; primitive-keyed memos that wanted to
 * cache `undefined` would need a different shape.
 */
function createScanMemo<K, V>(equals: (a: K, b: K) => boolean) {
  let key: K | undefined;
  let value: V | undefined;
  return {
    get(probe: K): V | undefined {
      if (key !== undefined && equals(probe, key)) return value;
      return undefined;
    },
    set(probe: K, v: V) {
      key = probe;
      value = v;
    },
    clear() {
      key = undefined;
      value = undefined;
    },
  };
}

interface PinKey {
  yaml: string;
  // Cache distinguishes `undefined` (no exclude range) from
  // `0` exactly via `===`, so a future caller passing `0` as
  // a line number won't collide with the unset state. (`===`
  // and `Object.is` agree for the realistic shapes here —
  // strings, integers, undefined; the only divergent case is
  // NaN, which line numbers can't be.)
  excludeFromLine: number | undefined;
  excludeToLine: number | undefined;
}
const pinKeyEquals = (a: PinKey, b: PinKey) =>
  a.yaml === b.yaml &&
  a.excludeFromLine === b.excludeFromLine &&
  a.excludeToLine === b.excludeToLine;
const pinMemo = createScanMemo<PinKey, Map<number, string>>(pinKeyEquals);

export function findUsedPins(
  yaml: string,
  excludeFromLine?: number,
  excludeToLine?: number,
): Map<number, string> {
  const probe: PinKey = { yaml, excludeFromLine, excludeToLine };
  const cached = pinMemo.get(probe);
  if (cached) return cached;
  const used = new Map<number, string>();
  if (!yaml) {
    // Don't cache the empty-yaml early return: a future
    // regression that needs to do exclude-range work even on
    // empty input would be silently masked by a cached empty
    // Map. Empty input is also rare on the hot path (the form
    // doesn't render its pin selectors until yaml has loaded).
    return used;
  }
  const lines = yaml.split("\n");
  let currentDomain = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const topMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*):/);
    if (topMatch) {
      currentDomain = topMatch[1];
      continue;
    }
    const lineNo = i + 1;
    if (
      excludeFromLine !== undefined &&
      excludeToLine !== undefined &&
      lineNo >= excludeFromLine &&
      lineNo <= excludeToLine
    ) {
      continue;
    }
    for (const m of line.matchAll(/GPIO(\d+)/g)) {
      const num = parseInt(m[1], 10);
      if (!Number.isNaN(num) && !used.has(num) && currentDomain) {
        used.set(num, currentDomain);
      }
    }
  }
  pinMemo.set(probe, used);
  return used;
}

/**
 * 1-indexed line number of the first sibling that comes after the
 * section starting at `fromLine`. Used to bound `excludeToLine` for
 * `findUsedPins`. Returns `lines.length` if the section runs to EOF.
 */
export function sectionEndLine(
  yaml: string,
  fromLine?: number,
): number | undefined {
  if (fromLine === undefined) return undefined;
  const lines = yaml.split("\n");
  for (let i = fromLine; i < lines.length; i++) {
    const line = lines[i];
    if (line === "") continue;
    if (/^[a-zA-Z]/.test(line)) return i;
  }
  return lines.length;
}

/**
 * Walk the YAML and return every `id:` (with its sibling `name:`) found
 * inside the given top-level domain. Block-list items reset the cursor
 * so each list element produces its own `{ id, name }` record.
 */
interface RefKey {
  yaml: string;
  domain: string;
}
const refKeyEquals = (a: RefKey, b: RefKey) =>
  a.yaml === b.yaml && a.domain === b.domain;
const refMemo = createScanMemo<
  RefKey,
  Array<{ id: string; name: string }>
>(refKeyEquals);

export function findReferencedComponents(
  yaml: string,
  domain: string,
): Array<{ id: string; name: string }> {
  if (!domain) return [];
  const probe: RefKey = { yaml, domain };
  const cached = refMemo.get(probe);
  if (cached) return cached;
  const lines = yaml.split("\n");
  const result: Array<{ id: string; name: string }> = [];
  let inSection = false;
  let currentId = "";
  let currentName = "";

  const flush = () => {
    if (currentId) result.push({ id: currentId, name: currentName });
    currentId = "";
    currentName = "";
  };

  for (const line of lines) {
    const topMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*):/);
    if (topMatch) {
      flush();
      inSection = topMatch[1] === domain;
      continue;
    }
    if (!inSection) continue;
    if (/^\s*-\s/.test(line)) flush();
    const idMatch = line.match(/^\s+(?:-\s+)?id:\s*["']?(\S+?)["']?\s*$/);
    if (idMatch) {
      currentId = idMatch[1];
      continue;
    }
    const nameMatch = line.match(/^\s+(?:-\s+)?name:\s*["']?(.+?)["']?\s*$/);
    if (nameMatch) {
      currentName = nameMatch[1];
    }
  }
  flush();
  refMemo.set(probe, result);
  return result;
}

/**
 * Test-only: clear both memos so cache state can't leak between
 * cases. Production callers don't need this — within an editor
 * session the memo's eviction-on-key-change is the right
 * semantics — but tests asserting cache identity want a clean
 * slate.
 */
export function _clearScanMemos(): void {
  pinMemo.clear();
  refMemo.clear();
}
