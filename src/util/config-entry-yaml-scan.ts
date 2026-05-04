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
/** Single-entry memo: caches the full pin map for a `yaml` +
 *  `excludeFromLine:excludeToLine` combination. The form re-renders
 *  on every keystroke into the YAML pane (the live `yaml` prop is a
 *  pin-renderer dependency); the section editor's exclude range is
 *  stable across that same edit window, so a paste-then-type
 *  workflow gets cache hits on every keystroke. */
let _pinMemoKey = "";
let _pinMemoValue: Map<number, string> | null = null;

export function findUsedPins(
  yaml: string,
  excludeFromLine?: number,
  excludeToLine?: number,
): Map<number, string> {
  const key = `${excludeFromLine ?? "_"}:${excludeToLine ?? "_"}${yaml}`;
  if (key === _pinMemoKey && _pinMemoValue) return _pinMemoValue;
  const used = new Map<number, string>();
  if (!yaml) {
    _pinMemoKey = key;
    _pinMemoValue = used;
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
  _pinMemoKey = key;
  _pinMemoValue = used;
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
/** Single-entry memo for the id-reference scan, keyed by
 *  (yaml, domain). Same rationale as `findUsedPins`'s memo —
 *  the form's id-reference picker re-renders on every keystroke;
 *  domain is stable across that window. */
let _refMemoKey = "";
let _refMemoValue: Array<{ id: string; name: string }> | null = null;

export function findReferencedComponents(
  yaml: string,
  domain: string,
): Array<{ id: string; name: string }> {
  if (!domain) return [];
  const key = `${domain}:${yaml}`;
  if (key === _refMemoKey && _refMemoValue) return _refMemoValue;
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
  _refMemoKey = key;
  _refMemoValue = result;
  return result;
}
