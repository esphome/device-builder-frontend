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
import type { ComponentCatalogEntry } from "../api/types/components.js";
import { isValidEspHomeId } from "./esphome-id.js";
import { isPinFieldKey, parsePinGpio, scanPinGpios } from "./pin-gpio.js";
import { hasSubstitutionReference } from "./substitutions.js";
import { indentOf } from "./yaml-line-walker.js";
import {
  collectIdsAtPath,
  findFieldLine,
  parseYamlTopLevelSections,
  readInstanceScalar,
  type YamlSection,
} from "./yaml-sections-core.js";

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
const pinMemo = createScanMemo<PinKey, Map<number | string, string>>(pinKeyEquals);

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
 * Read a long-form pin block opened at `openerIdx` (a `pin:` / `*_pin:` key
 * with no inline value) into its canonical identity via {@link parsePinGpio} — a
 * board GPIO `number`, or the `provider:hub_id:channel` token when the block
 * sits on an I/O expander. Reconstructs the block's direct-child scalars into a
 * mapping and defers the identity decision to `parsePinGpio`; only the direct
 * children are collected so a nested `mode:` map's flags can't masquerade as a
 * provider key. Returns the identity plus the 0-indexed last line the block
 * spans so the caller can skip past it.
 */
function readLongFormPin(
  lines: string[],
  openerIdx: number
): { pin: number | string | null; end: number } {
  const openIndent = indentOf(lines[openerIdx]);
  let childIndent = -1;
  const block: Record<string, string> = {};
  let end = openerIdx;
  for (let j = openerIdx + 1; j < lines.length; j++) {
    const line = lines[j];
    if (line.trim() === "") {
      end = j;
      continue;
    }
    const indent = indentOf(line);
    if (indent <= openIndent) break;
    end = j;
    const m = line.match(LINE_KEY_RE);
    if (m === null) continue; // comment / non-key line — don't anchor childIndent on it
    if (childIndent === -1) childIndent = indent;
    if (indent !== childIndent) continue; // skip grandchildren (mode flags)
    // Record the key even when it has no inline scalar (an empty, mid-edit
    // `pcf8574:`), so parsePinGpio sees the provider and returns null rather
    // than letting the bare `number:` alias a board GPIO.
    block[m[2]] = readInstanceScalar(stripInlineComment(line), m[2]) ?? "";
  }
  return { pin: parsePinGpio(block), end };
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
): Map<number | string, string> {
  const probe: PinKey = { yaml, excludeFromLine, excludeToLine };
  const cached = pinMemo.get(probe);
  if (cached) return cached;
  const used = new Map<number | string, string>();
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
      if (line.trim() === "" || indentOf(line) > blockScalarIndent) continue;
      blockScalarIndent = -1;
    }
    const keyMatch = line.match(LINE_KEY_RE);
    if (keyMatch && FREETEXT_PIN_KEYS.has(keyMatch[2].toLowerCase())) {
      // Measure the threshold with the same spaces-only ``indentOf`` used in
      // the skip comparison above, so a tab in malformed indentation cannot
      // end the block scalar one line early.
      if (BLOCK_SCALAR_RE.test(line)) blockScalarIndent = indentOf(line);
      continue;
    }
    const stripped = stripInlineComment(line);
    // A bare-integer pin value (`tx_pin: 1`) carries no prefix for the token
    // scan to anchor on; parse it from a pin-field key's value instead.
    if (keyMatch && isPinFieldKey(keyMatch[2])) {
      const inline = stripped.slice(keyMatch[0].length).trim();
      if (inline === "") {
        // Long-form pin block: read it as a unit so an expander channel is
        // namespaced (never aliasing a board GPIO) and a nested `mode:` map
        // isn't mis-scanned, then skip the lines it spans.
        const { pin, end } = readLongFormPin(lines, i);
        if (pin !== null && !used.has(pin)) used.set(pin, currentDomain);
        i = end;
        continue;
      }
      const gpio = parsePinGpio(inline);
      if (gpio !== null && !used.has(gpio)) used.set(gpio, currentDomain);
    }
    for (const num of scanPinGpios(stripped)) {
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
 *  an empty stem matches every id in the ``domain:`` block. ``idPaths`` set
 *  means the interface id is nested (usb_uart's ``channels[].id``): collect
 *  ids at those key-paths within the matched section instead of its own id. */
export interface ComponentProvider {
  domain: string;
  stem: string;
  idPaths?: string[][];
}

/** Split a catalog id into a provider: ``"sensor.adc"`` → ``{sensor, adc}``;
 *  a bare ``"ble_nus"`` → ``{ble_nus, ""}`` (a top-level component). */
export function parseCatalogId(id: string): ComponentProvider {
  const dot = id.indexOf(".");
  return dot === -1
    ? { domain: id, stem: "" }
    : { domain: id.slice(0, dot), stem: id.slice(dot + 1) };
}

/** A catalog entry as a provider of *interfaceName*, carrying the nested
 *  ``idPaths`` when its id for that interface isn't its own top-level id.
 *  Single source of truth for the visual picker and YAML autocomplete so
 *  the two surfaces can't drift on what counts as a candidate. */
export function catalogEntryToProvider(
  entry: ComponentCatalogEntry,
  interfaceName: string
): ComponentProvider {
  const provider = parseCatalogId(entry.id);
  const idPaths = entry.provides_id_paths?.[interfaceName];
  return idPaths?.length ? { ...provider, idPaths } : provider;
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
  // JSON-encode each provider so the cache key can't collide on a separator
  // char inside a domain / stem / path segment.
  const signature = providers
    .map((p) => JSON.stringify([p.domain, p.stem, p.idPaths ?? []]))
    .sort()
    .join(",");
  const probe: ProviderKey = { yaml, signature };
  const cached = providerMemo.get(probe);
  if (cached) return cached;

  const byDomain = new Map<string, ComponentProvider[]>();
  for (const p of providers) {
    const list = byDomain.get(p.domain) ?? [];
    list.push(p);
    byDomain.set(p.domain, list);
  }

  const result: Array<{ id: string; name: string }> = [];
  const seen = new Set<string>();
  const add = (id: string, name: string): void => {
    if (id && !seen.has(id)) {
      seen.add(id);
      result.push({ id, name });
    }
  };
  // Split once, lazily: only nested-id providers (the rare case) need the
  // lines, so the common own-id scan pays nothing.
  let lines: string[] | null = null;
  for (const section of parseYamlTopLevelSections(yaml)) {
    const provs = byDomain.get(section.parentKey ?? section.key);
    if (!provs) continue;
    for (const p of provs) {
      // ``stem === ""`` matches every id in the domain block.
      if (p.stem !== "" && p.stem !== section.platform) continue;
      if (p.idPaths?.length) {
        // The interface id is nested (usb_uart channels[].id): collect the
        // ids at those paths, not the section's own (non-interface) id.
        lines ??= yaml.split("\n");
        for (const path of p.idPaths) {
          for (const inst of collectIdsAtPath(lines, section, path))
            add(inst.id, inst.name);
        }
      } else if (section.id) {
        add(section.id, section.name ?? "");
      }
    }
  }
  providerMemo.set(probe, result);
  return result;
}

// An instance's GPIO for a pin field, handling both the bare scalar
// (`scl: 0`) and the expanded block (`scl:\n  number: GPIO0`) forms; null
// when the field is absent or its value isn't a parseable pin.
function readInstancePinGpio(
  yaml: string,
  lines: string[],
  section: YamlSection,
  key: string
): number | string | null {
  const lineNo = findFieldLine(yaml, section, [key]);
  if (lineNo === null) return null;
  const scalar = parsePinGpio(readInstanceScalar(lines[lineNo - 1], key));
  if (scalar !== null) return scalar;
  // Expanded form: read the long-form block (board GPIO, or the
  // `provider:hub_id:channel` token when the pin sits on an I/O expander).
  return readLongFormPin(lines, lineNo - 1).pin;
}

/**
 * True when an existing instance under `domain:` occupies every pin in
 * `lockedPins` (pin field key -> canonical GPIO) on a SINGLE instance — i.e. the
 * same peripheral is already wired on the same pins. Drives the catalog's hide
 * of a featured card whose fixed wiring is already present. `lockedPins` comes
 * from the schema (backend), so the pin keys are authoritative — no key-name
 * guessing. An empty map returns false. `parseYamlTopLevelSections` is memoized,
 * so calling this per card is cheap.
 */
export function domainOccupiesPins(
  yaml: string,
  domain: string,
  lockedPins: Readonly<Record<string, number | string>>
): boolean {
  const keys = Object.keys(lockedPins);
  if (keys.length === 0) return false;
  const lines = yaml.split("\n");
  for (const section of parseYamlTopLevelSections(yaml)) {
    if ((section.parentKey ?? section.key) !== domain) continue;
    const occupies = keys.every(
      (key) => readInstancePinGpio(yaml, lines, section, key) === lockedPins[key]
    );
    if (occupies) return true;
  }
  return false;
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

// A top-level (zero-indent) `packages:` block or `<<:` merge key — the two
// constructs that merge whole component sections in from sources the scan
// can't see. A value-position `!include` (`wifi: !include wifi.yaml`) only
// replaces that key's value, so it deliberately doesn't match.
const MERGED_SOURCE_RE = /^(?:packages|<<)\s*:/m;
const MERGE_KEY_RE = /^\s*<<\s*:/m;

/**
 * Whether the YAML root-merges components the scan can't enumerate.
 *
 * True when a top-level `packages:` block or `<<:` merge key is present —
 * either can introduce additional `<domain>:` sections from another file, so
 * single-candidate reference resolution can't be trusted.
 */
export function yamlHasMergedSources(yaml: string): boolean {
  if (!yaml) return false;
  return MERGED_SOURCE_RE.test(yaml);
}

/**
 * Whether the YAML pulls in ids the local scan can't see: merged sources
 * (`packages:` / `<<:`) or any `!include`d value (a value-position or
 * list-item `!include` defines ids in another file). When true, a value missing
 * from the candidate scan isn't proof of a dangling reference.
 */
export function yamlHasExternalIdSources(yaml: string): boolean {
  const hit = externalMemo.get(yaml);
  if (hit !== undefined) return hit;
  // Any include-family tag — `!include`, `!include_dir_list`,
  // `!include_dir_merge_list`, … — in value or list-item position can
  // define ids the local scan can't see; so can a merge key at any
  // indent (`<<: *anchor` inside a component can merge an `id:` in),
  // unlike yamlHasMergedSources' deliberately top-level scope.
  const result =
    yamlHasMergedSources(yaml) || MERGE_KEY_RE.test(yaml) || yaml.includes("!include");
  externalMemo.set(yaml, result);
  return result;
}

const externalMemo = createScanMemo<string, boolean>((a, b) => a === b);

/**
 * Whether *value* is a reference the local scan is certain dangles: an
 * identifier-shaped id (substitutions and !secret indirections can't be
 * checked) absent from a candidate list that's fully comparable (no
 * candidate id needs substitution to compare) in a buffer that pulls no
 * ids in from other files. Callers own their own gates (backend-error
 * precedence, provider settling) — this is the pure verdict.
 */
export function isCertainlyDanglingId(
  value: string,
  candidates: ReadonlyArray<{ id: string }>,
  yaml: string
): boolean {
  return (
    isValidEspHomeId(value) &&
    !candidates.some((c) => c.id === value || hasSubstitutionReference(c.id)) &&
    !yamlHasExternalIdSources(yaml)
  );
}

/**
 * The single candidate to resolve an omitted reference to, or null when
 * ambiguous — none, several, or a `packages:`/`<<:` merge that could hide one.
 * Shared by the id-reference picker (shows it as the default) and featured-add
 * seeding (writes it).
 */
export function resolveSoleCandidate(
  candidates: ReadonlyArray<{ id: string; name: string }>,
  yaml: string
): { id: string; name: string } | null {
  return candidates.length === 1 && !yamlHasMergedSources(yaml) ? candidates[0] : null;
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
  externalMemo.clear();
}
