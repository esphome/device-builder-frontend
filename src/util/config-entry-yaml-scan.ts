/*
 * YAML scanning helpers used by the ConfigEntry form to (a) detect pin
 * conflicts between sections and (b) discover ID references for the
 * id-reference picker. These are deliberately tiny, line-based scans —
 * a full YAML parse is overkill for the few keys we care about, and the
 * source is the user's working YAML which may be mid-edit.
 *
 * The form re-renders on every keystroke (live `yaml` prop is a
 * dependency of pin / id pickers), so both scans are memoised
 * single-entry on `(yaml, ...key)` via value equality (`a.yaml ===
 * b.yaml` on primitive strings, with the engine's pointer-equality
 * fast path on the typical render cycle). Re-renders that don't
 * change the yaml return cached results; an actual yaml change
 * re-scans once. Linear scans on the typical config (<200 lines)
 * are sub-millisecond even without the cache, but memoisation
 * collapses the worst case (paste a multi-thousand-line config,
 * type into a field) from O(N) per keystroke to O(1).
 */
import { scanPinGpios } from "./pin-gpio.js";
import { parseYamlTopLevelSections } from "./yaml-sections-core.js";

/**
 * Single-entry memo for the YAML scans. The hot path is the
 * form re-rendering on every keystroke into the YAML pane:
 * the live `yaml` prop is a dependency of the pin and
 * id-reference renderers, and the section editor's exclude
 * range / domain are stable across that same edit window — so
 * a paste-then-type workflow gets cache hits on every
 * keystroke.
 *
 * Key comparison uses `a.yaml === b.yaml` directly, which on
 * primitive strings is value equality, not reference identity.
 * In practice the parent (`pages/device.ts::_yaml`) hands us
 * the same string instance until the user types, so engines
 * typically short-circuit on pointer equality — no byte-compare
 * on the typical equal-content fast path. When content differs
 * they short-circuit on length and other structural
 * mismatches. The unusual shape (two distinct strings with
 * identical content) is the only one that forces an O(N)
 * byte-compare; the typical render cycle doesn't produce
 * that.
 *
 * The cache is content-keyed: a refactor that constructs a
 * fresh string per render with the same content still hits
 * (modulo the byte-compare cost noted above), and a content
 * change misses regardless of identity. So the contract
 * here is "same content → same cached result", and consumers
 * of `_yaml` don't need to preserve string identity for
 * correctness — only for the O(1) fast path.
 *
 * Wrapping the state in a small factory keeps the reset list
 * (`_clearScanMemos`) single-source — adding a third memo
 * just means a new `createScanMemo<K, V>(equals)` line, not
 * editing two places.
 *
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

// Keys whose values are free-form human text. `scanPinGpios` is
// deliberately value-context-agnostic (it's shared with the pin picker,
// which only ever sees real pin values), so a token like "P0.5" or "PA02"
// sitting in a device name reads as a pin to it. In a name/comment that's
// prose, not a pin reference — counting it produces a phantom used-pin and
// a spurious cross-section conflict warning. Skip these keys' lines.
const FREETEXT_PIN_KEYS = new Set(["name", "friendly_name", "comment"]);

// Leading `key:` of an indented (or list-item) mapping line. Captures the
// leading indentation (group 1) and the key (group 2) so a block-scalar
// value under a free-text key can be skipped by indentation.
const LINE_KEY_RE = /^(\s*)(?:-\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\s*:/;

// A `key:` whose value is a block scalar (`|` / `>`, with optional chomping
// `+`/`-` and explicit-indent digit, plus an optional trailing comment).
// Its continuation lines are more-indented prose, scanned via indentation.
const BLOCK_SCALAR_RE = /:\s*[|>][+-]?\d*\s*(?:#.*)?$/;

// Leading-whitespace width of a line (block-scalar indentation threshold).
const indentWidth = (line: string): number => line.length - line.trimStart().length;

/**
 * Strip a YAML inline comment. A `#` begins a comment only at line start
 * or when preceded by whitespace (so `http://x#y` keeps its `#`). Pin
 * values never contain `#`, so cutting here can't drop a real pin token —
 * but it does keep a `# spare PA02` trailing comment from registering a
 * phantom pin.
 *
 * This is intentionally NOT quote-aware: a `#` inside a quoted scalar
 * (`id: "x # GPIO5"`) is treated as a comment start and truncated. That's
 * fine here — the strip is false-positive-only, and a pin-shaped token
 * buried in a quoted comment-like tail was already a phantom match before
 * this strip existed. Real pin values are never quoted-with-`#`, so quote
 * tracking (single vs double, escapes, flow scalars) would add complexity
 * for a case that can't surface a real conflict. Don't "fix" it.
 */
function stripInlineComment(line: string): string {
  const m = line.match(/(^|\s)#/);
  return m === null ? line : line.slice(0, (m.index ?? 0) + m[1].length);
}

/**
 * Map every pin reference in the YAML to the top-level domain that
 * owns it (e.g. `{ 4: "switch", 5: "binary_sensor" }`). Pin tokens are
 * matched across every platform form (`GPIOn`, bk72xx `P{n}`, rtl87xx
 * `PA{n}`, nRF52 `P{port}.{pin}`) via `scanPinGpios`, so conflict
 * warnings fire for LibreTiny / nRF52 configs too, not just ESP ones.
 * Free-text keys (`name`/`comment`) and inline `#` comments are excluded
 * first, so a pin-shaped token in prose doesn't register as a used pin.
 * The free-text skip also covers a block scalar (`comment: >` / `comment: |`):
 * its more-indented continuation lines are skipped by indentation, so a
 * pin-shaped token in multi-line prose doesn't register either.
 * When `excludeFromLine` / `excludeToLine` are provided the lines
 * in that (inclusive) 1-indexed range are skipped — used by the
 * section editor so a pin selector doesn't flag the user's *own*
 * pin as already in use.
 */
export function findUsedPins(
  yaml: string,
  excludeFromLine?: number,
  excludeToLine?: number
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
  // Indentation of an open free-text block scalar; continuation lines
  // indented deeper than this are prose and skipped. -1 when none is open.
  let blockScalarIndent = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const topMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*):/);
    if (topMatch) {
      currentDomain = topMatch[1];
      blockScalarIndent = -1;
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
    if (!currentDomain) continue;
    // Inside an open free-text block scalar: skip blank lines and any line
    // indented deeper than the key. A non-blank line at/under the key indent
    // ends the block.
    if (blockScalarIndent >= 0) {
      if (line.trim() === "" || indentWidth(line) > blockScalarIndent) continue;
      blockScalarIndent = -1;
    }
    const keyMatch = line.match(LINE_KEY_RE);
    if (keyMatch && FREETEXT_PIN_KEYS.has(keyMatch[2].toLowerCase())) {
      if (BLOCK_SCALAR_RE.test(line)) blockScalarIndent = keyMatch[1].length;
      continue;
    }
    for (const num of scanPinGpios(stripInlineComment(line))) {
      if (!used.has(num)) used.set(num, currentDomain);
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
export function sectionEndLine(yaml: string, fromLine?: number): number | undefined {
  if (fromLine === undefined) return undefined;
  const lines = yaml.split("\n");
  for (let i = fromLine; i < lines.length; i++) {
    const line = lines[i];
    if (line === "") continue;
    if (/^[a-zA-Z]/.test(line)) return i;
  }
  return lines.length;
}

/** One provider of an interface: a catalog domain and optional platform
 *  stem. ``{sensor, adc}`` matches a ``sensor:`` item with ``platform: adc``;
 *  an empty stem matches every id in the ``domain:`` block. */
export interface ComponentProvider {
  domain: string;
  stem: string;
}

/** Split a catalog id into a provider: ``"sensor.adc"`` → ``{sensor, adc}``;
 *  a bare ``"ble_nus"`` → ``{ble_nus, ""}`` (a top-level component). */
export function parseCatalogId(id: string): ComponentProvider {
  const dot = id.indexOf(".");
  return dot === -1
    ? { domain: id, stem: "" }
    : { domain: id.slice(0, dot), stem: id.slice(dot + 1) };
}

interface ProviderKey {
  yaml: string;
  signature: string;
}
const providerKeyEquals = (a: ProviderKey, b: ProviderKey) =>
  a.yaml === b.yaml && a.signature === b.signature;
const providerMemo = createScanMemo<ProviderKey, Array<{ id: string; name: string }>>(
  providerKeyEquals
);

/**
 * Configured components matching a set of providers.
 *
 * For each provider, keeps a configured instance under its ``domain:`` block
 * whose ``platform`` matches the provider stem (or every id when the stem is
 * empty, e.g. a top-level component like a ``uart``-providing ``ble_nus:``).
 * Delegates the YAML structure to {@link parseYamlTopLevelSections} so nested
 * lists (``filters:``) and sub-mappings don't break item boundaries. The
 * building block under {@link findReferenceCandidates}.
 */
export function findComponentsByProviders(
  yaml: string,
  providers: ReadonlyArray<ComponentProvider>
): Array<{ id: string; name: string }> {
  if (!providers.length) return [];
  const signature = providers
    .map((p) => `${p.domain}.${p.stem}`)
    .sort()
    .join(",");
  const probe: ProviderKey = { yaml, signature };
  const cached = providerMemo.get(probe);
  if (cached) return cached;

  // ``stem === ""`` for any provider in a domain means "match every id".
  const stemsByDomain = new Map<string, Set<string>>();
  for (const p of providers) {
    const stems = stemsByDomain.get(p.domain) ?? new Set<string>();
    stems.add(p.stem);
    stemsByDomain.set(p.domain, stems);
  }

  const result: Array<{ id: string; name: string }> = [];
  const seen = new Set<string>();
  for (const section of parseYamlTopLevelSections(yaml)) {
    if (!section.id || seen.has(section.id)) continue;
    const stems = stemsByDomain.get(section.parentKey ?? section.key);
    if (!stems) continue;
    if (
      stems.has("") ||
      (section.platform !== undefined && stems.has(section.platform))
    ) {
      seen.add(section.id);
      result.push({ id: section.id, name: section.name ?? "" });
    }
  }
  providerMemo.set(probe, result);
  return result;
}

/**
 * Configured components that satisfy a reference, via its providers.
 *
 * The reference's own domain is an implicit provider (empty stem ⇒ every id
 * in that ``<domain>:`` block), so same-domain (``i2c``) and cross-domain
 * (``voltage_sampler`` → ADC sensors under ``sensor:``) references resolve
 * through one scan. Shared by the visual editor and the YAML autocomplete.
 */
export function findReferenceCandidates(
  yaml: string,
  domain: string,
  providers: ReadonlyArray<ComponentProvider>
): Array<{ id: string; name: string }> {
  if (!domain) return [];
  return findComponentsByProviders(yaml, [{ domain, stem: "" }, ...providers]);
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
  providerMemo.clear();
}
