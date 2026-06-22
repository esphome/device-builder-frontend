/**
 * Schema-driven YAML autocompletion — catalog & cursor-context layer.
 *
 * The foundation of the completion stack: cursor-position matchers,
 * the component-catalog index (loaded once per session), the
 * parent-block → schema-bundle mapping, config-entry resolution, and
 * the AST-with-regex-fallback context resolver. The completion source
 * (``yaml-completion``) and the key-position providers
 * (``yaml-completion-providers``) both build on these primitives;
 * nothing here depends back on either, keeping the dependency flow
 * one-directional.
 */
import type { EditorState } from "@codemirror/state";
import type { ESPHomeAPI } from "../api/esphome-api.js";
import type { ComponentCatalogEntry } from "../api/types/components.js";
import { ConfigEntryType, type ConfigEntry } from "../api/types/config-entries.js";
import { fetchComponent } from "./component-name-cache.js";
import { getKeyPath, resolveBundleContext } from "./yaml-ast.js";
import { findTopLevelBlock, readPlatformSibling } from "./yaml-line-walker.js";

// ``validFor`` regex constants — consumed by CodeMirror to decide
// whether cached completion options stay valid as the user types.
const RE_KEY = /^[A-Za-z0-9_]*$/;
/** Trigger-prefix gate for the trigger-keys provider — every
 *  ESPHome trigger starts with ``on_``; partials matching this
 *  shape may yet become a trigger, so it's worth fetching the
 *  schema. Anything else (``platform``, ``name``, ``device_class``,
 *  …) saves the round-trip. Explicit ctrl-space bypasses the
 *  gate so power users can browse. */
const RE_TRIGGER_PREFIX = /^o(n(_[a-z0-9_]*)?)?$/i;
// Cursor-position matchers. ``plain`` covers ordinary nested-key
// editing (``  partial``); ``list`` covers list-item position
// (``  - partial``) — the entry point for action-registry
// completion inside ``then:``. The list form accepts ``.`` in
// the partial because actions are dotted (``logger.log``).
const RE_KEY_POSITION_PLAIN = /^(\s*)([A-Za-z0-9_]*)$/;
const RE_KEY_POSITION_LIST = /^(\s*)-\s+([A-Za-z0-9_.]*)$/;

interface KeyPosition {
  leading: string;
  partial: string;
  /** True when the user typed (or is starting) a list-item dash
   *  before the partial. Drives action-registry vs. plain-key
   *  completion paths. */
  isListItem: boolean;
}

/**
 * Match the text before the cursor against the two key-position
 * shapes and return the canonicalised pieces, or ``null`` if the
 * cursor isn't in a key-position at all (e.g. mid-value or
 * inside a comment). One callsite, one return shape — keeps the
 * completion source readable.
 */
export function matchKeyPosition(before: string): KeyPosition | null {
  const plain = before.match(RE_KEY_POSITION_PLAIN);
  if (plain) return { leading: plain[1], partial: plain[2], isListItem: false };
  const list = before.match(RE_KEY_POSITION_LIST);
  if (list) return { leading: list[1], partial: list[2], isListItem: true };
  return null;
}

interface ValuePosition {
  leading: string;
  key: string;
  partial: string;
}

// Cursor is to the right of ``key:`` on the current line. Accepts
// both plain (``  key: partial``) and list-item header
// (``  - key: partial``) shapes — the dash form is the entry
// point for ``- platform: <value>`` completion under domain
// blocks like ``binary_sensor:``.
const RE_VALUE_POSITION = /^(\s*)(?:-\s+)?([A-Za-z0-9_]+)\s*:\s*(\S*)$/;

/**
 * Match the text before the cursor against the value-position
 * shape (cursor is past a ``key:``). Returns ``null`` when the
 * cursor is in a key-position or mid-line. ``leading`` excludes
 * the optional ``- `` list-item dash so callers comparing it to
 * other indents (e.g. ``findTopLevelBlock``) don't need to
 * special-case the dash column.
 */
export function matchValuePosition(before: string): ValuePosition | null {
  const m = before.match(RE_VALUE_POSITION);
  if (!m) return null;
  return { leading: m[1], key: m[2], partial: m[3] };
}
// Boolean-value typing — only ``true`` / ``false`` matter, so any
// further character drops the popup.
const RE_BOOLEAN_VALUE = /^[A-Za-z]*$/;
// Enum-value characters: digits / letters / dot / slash / dash so
// ``8N1``, ``Noise_NNpsk0_25519_…``, ``UNKNOWN-state``, dotted
// platform names all keep typing.
const RE_ENUM_VALUE = /^[A-Za-z0-9_./-]*$/;
// Action-registry keys are dotted (``logger.log``, ``light.turn_on``)
// — the regex must accept ``.`` or CodeMirror discards the result
// the moment the user types past the dot.
const RE_KEY_OR_ACTION = /^[A-Za-z0-9_.]*$/;

export interface CatalogIndex {
  /** Loaded list of components — used for top-level keys. */
  components: ComponentCatalogEntry[];
  /** id → component for direct lookups. */
  byId: Map<string, ComponentCatalogEntry>;
  /** category → components in that category (for `platform:` value lookups). */
  byCategory: Map<string, ComponentCatalogEntry[]>;
}

let catalogPromise: Promise<CatalogIndex> | null = null;

/**
 * Load the component catalog once per session. The list is small enough
 * (~1k entries) to keep entirely in memory; caching avoids re-fetching
 * on every keystroke.
 */
export function loadCatalog(api: ESPHomeAPI): Promise<CatalogIndex> {
  if (catalogPromise) return catalogPromise;
  catalogPromise = (async () => {
    const res = await api.getComponents({ limit: 2000 });
    const byId = new Map<string, ComponentCatalogEntry>();
    const byCategory = new Map<string, ComponentCatalogEntry[]>();
    for (const c of res.components) {
      byId.set(c.id, c);
      const list = byCategory.get(c.category) ?? [];
      list.push(c);
      byCategory.set(c.category, list);
    }
    return { components: res.components, byId, byCategory };
  })().catch((err) => {
    console.debug("[yaml-completion] failed to load catalog:", err);
    catalogPromise = null;
    return { components: [], byId: new Map(), byCategory: new Map() };
  });
  return catalogPromise;
}

/**
 * Map a YAML parent block (``esphome``, ``binary_sensor`` plus a
 * ``platform: gpio`` sibling, …) to the schema-bundle filename and
 * the component key inside that bundle.
 *
 * The schema host's bundle layout is *implementation-keyed*, not
 * domain-keyed:
 *   - ``binary_sensor.json`` carries only ``binary_sensor`` (the
 *     domain — its shared ``_BINARY_SENSOR_SCHEMA`` plus the
 *     condition / filter registries).
 *   - ``gpio.json`` carries the per-domain implementations:
 *     ``gpio.binary_sensor``, ``gpio.switch``, ``gpio.output``…
 *
 * So the correct lookup for ``binary_sensor: - platform: gpio``
 * is bundle ``gpio``, component ``gpio.binary_sensor``. Domain-
 * shared triggers (``on_press``, ``on_release``, …) live inside
 * the ``_BINARY_SENSOR_SCHEMA`` referenced by the platform's
 * ``extends`` chain — ``getTriggerKeys`` follows that chain.
 */
export function bundleFor(
  topLevelKey: string,
  platformValue: string | null
): { bundle: string; componentKey: string } {
  return platformValue
    ? {
        bundle: platformValue,
        componentKey: `${platformValue}.${topLevelKey}`,
      }
    : { bundle: topLevelKey, componentKey: topLevelKey };
}

// ─── Lookups ─────────────────────────────────────────────────────────

/**
 * Resolve the config entries available *under* a parent key. Handles the
 * `sensor: - platform: dht` case: when the parent is a category-style block
 * (sensor/binary_sensor/switch/...) and the current item declares a
 * `platform: <id>`, merge the platform component's config entries with
 * any matching sub_entries from the parent.
 *
 * The catalog keys per-platform implementations as ``<domain>.<stem>``
 * (e.g. ``binary_sensor.template``). When the indent walker hands us
 * a literal ``platform`` key (which is what ``- platform: template``
 * looks like to a regex), we'd otherwise fail to find any
 * config_entries for the form fields the user is actually typing.
 * Recognise that case and fall back to the dotted lookup using the
 * top-level domain — covered by the AST-supplied ``topLevelKey``
 * passed alongside the regex-derived ``parentKey``.
 */
export async function resolveAvailableEntries(
  api: ESPHomeAPI,
  catalog: CatalogIndex,
  parentKey: string,
  platformValue: string | null,
  topLevelKey: string | null,
  resolveNestedPath: () => string[] = () => []
): Promise<ConfigEntry[]> {
  // The slim ``getComponents`` index carries no ``config_entries``
  // (those hydrate lazily through ``components/get_component_bodies``),
  // so the catalog tells us only *which* ids exist — never their
  // fields. Hydrate the body for an id known to the index; return
  // ``[]`` for unknown ids so we never fetch ``platform`` (or any
  // non-component key) and poison the session cache with a 404.
  // Tolerate fetch failures silently: ``BatchedCache`` rejects on a
  // transport error or a mid-flight ``_clearComponentCache()``, and the
  // completion source isn't wrapped — an unguarded throw here would drop
  // the whole popup instead of degrading to no suggestions.
  const entriesFor = async (id: string): Promise<ConfigEntry[]> => {
    if (!catalog.byId.has(id)) return [];
    try {
      const body = await fetchComponent(api, id);
      return body?.config_entries ?? [];
    } catch {
      return [];
    }
  };

  // Resolve a top-level component's fields, merging the platform
  // implementation's fields when a ``platform:`` value is set (the
  // catalog keys per-platform entries as ``<domain>.<stem>``). The merge
  // id is resolved up front so both bodies register before the microtask
  // flush and batch into a single ``get_component_bodies`` round trip.
  const componentEntries = async (componentId: string): Promise<ConfigEntry[]> => {
    let mergeId: string | null = null;
    if (platformValue) {
      if (catalog.byId.has(platformValue)) {
        mergeId = platformValue;
      } else if (catalog.byId.has(`${componentId}.${platformValue}`)) {
        mergeId = `${componentId}.${platformValue}`;
      }
    }
    if (mergeId) {
      const [own, extra] = await Promise.all([
        entriesFor(componentId),
        entriesFor(mergeId),
      ]);
      return [...own, ...extra];
    }
    return entriesFor(componentId);
  };

  // Cursor nested under a list-item header (``- platform: template``
  // → parentKey="platform"). The form fields live on the dotted
  // catalog id ``<domain>.<platformValue>`` (``binary_sensor.template``).
  if (parentKey === "platform") {
    if (!topLevelKey || !platformValue) return [];
    return entriesFor(`${topLevelKey}.${platformValue}`);
  }
  // Treat the parent as a top-level component only when it actually *is* the
  // top-level block. A nested group key can collide with a component id
  // (``web_server``, ``uart``, ``time``, …); preferring the component would
  // shadow the descent and surface the wrong fields. When the AST is silent
  // (``topLevelKey`` null) keep the direct lookup — the descent can't run
  // without it anyway.
  if (
    catalog.byId.has(parentKey) &&
    (topLevelKey === null || parentKey === topLevelKey)
  ) {
    return componentEntries(parentKey);
  }
  // Nested mapping (``esp32: framework:`` → parentKey="framework", not a
  // catalog id). Descend the top-level component's nested
  // ``config_entries`` along the key path; the catalog models nested
  // groups (``framework`` → ``advanced`` → …) the same way the visual
  // form renders them. Only reached once the cheaper branches miss, so the
  // path's AST walk stays off the common (cursor-under-a-component) path.
  const nestedPath = topLevelKey ? resolveNestedPath() : [];
  if (nestedPath.length > 0) {
    // ``null`` means the path didn't resolve (fall through to the alias
    // fetch); an empty array means a real but childless nested group, which
    // should surface no suggestions rather than trigger the network fallback.
    const descended = descendNestedEntries(
      await componentEntries(topLevelKey!),
      nestedPath
    );
    if (descended !== null) return descended;
  }
  // No direct hit — try fetching the component (handles aliases the
  // catalog list call doesn't return). Routes through the session-
  // scoped component cache so the same parent on every keystroke
  // doesn't re-issue the backend round-trip. Tolerate failures
  // silently.
  try {
    const comp = await fetchComponent(api, parentKey);
    if (comp) return comp.config_entries ?? [];
  } catch {
    /* ignore */
  }
  return [];
}

/**
 * Compute the nested-group descent path for ``resolveAvailableEntries``:
 * the key chain from just under the top-level component down to and
 * including *parentKey*. Returns ``[]`` when *parentKey* is the top-level
 * key itself or doesn't appear on the cursor's AST key path (safe
 * no-descent fallback when the AST and the regex walker disagree).
 */
export function nestedPathForParent(
  state: EditorState,
  pos: number,
  parentKey: string
): string[] {
  const path = getKeyPath(state, pos);
  const idx = path.lastIndexOf(parentKey);
  if (idx < 1) return [];
  return path.slice(1, idx + 1);
}

/**
 * Walk *entries* down *path*, descending into each matching entry's
 * nested ``config_entries``. Returns the deepest level reached (possibly
 * empty for a childless nested group), or ``null`` when any step has no
 * nested group for that key — letting the caller tell "resolved but empty"
 * apart from "path missing".
 */
export function descendNestedEntries(
  entries: ConfigEntry[],
  path: string[]
): ConfigEntry[] | null {
  let cur = entries;
  for (const key of path) {
    // Descend into any entry that carries child entries (``nested`` / ``pin``
    // / ``map``); a ``nested`` group can legitimately have ``null`` children
    // (treated as empty), so match it by type too rather than only by a
    // truthy ``config_entries``.
    const next = cur.find(
      (e) =>
        e.key === key && (e.config_entries != null || e.type === ConfigEntryType.NESTED)
    );
    if (!next) return null;
    cur = next.config_entries ?? [];
  }
  return cur;
}

/**
 * Resolve the cursor's structural context for completion lookups,
 * preferring the AST when it can answer and falling back to the
 * indent-text walkers otherwise.
 *
 * The AST handles list-item indent quirks the regex walkers miss
 * — specifically, ``readPlatformSibling`` breaks at the dash
 * column and never sees a ``platform:`` sibling sitting at the
 * list-item-body indent. The regex walkers stay as the fallback
 * for cases the AST can't answer (e.g. partial input that
 * doesn't parse cleanly).
 */
function resolveCompletionContext(
  state: EditorState,
  pos: number,
  lineIdx: number,
  indent: number
): {
  platformValue: string | null;
  topLevelKey: string | null;
  bundleCtx: ReturnType<typeof resolveBundleContext>;
} {
  const bundleCtx = resolveBundleContext(state, pos);
  // When the AST resolves ``bundleCtx`` it has read the cursor's
  // structure end-to-end — including a deliberate
  // ``platformValue: null`` for "cursor not inside a ``- platform:``
  // list-item". Trust that answer and don't fall through to the
  // regex walker (which can otherwise grab an unrelated
  // ``- platform: …`` line elsewhere in the doc and synthesise a
  // bogus context). The regex fallback fires only when the AST
  // is silent (half-typed pair, partial parse). Same rule for
  // ``topLevelKey``.
  if (bundleCtx) {
    return {
      bundleCtx,
      platformValue: bundleCtx.platformValue,
      topLevelKey: bundleCtx.topLevelKey,
    };
  }
  return {
    bundleCtx: null,
    platformValue: readPlatformSibling(state.doc, lineIdx, indent),
    topLevelKey: findTopLevelBlock(state.doc, lineIdx),
  };
}

// Re-exported for the completion source and provider layers. The
// position matchers, ``CatalogIndex``, ``loadCatalog``, ``bundleFor``
// and ``resolveAvailableEntries`` carry their own inline ``export``;
// the ``validFor`` regex constants and ``resolveCompletionContext``
// are surfaced here so the source closure can consume them without
// duplicating the definitions.
export {
  RE_BOOLEAN_VALUE,
  RE_ENUM_VALUE,
  RE_KEY,
  RE_KEY_OR_ACTION,
  RE_TRIGGER_PREFIX,
  RE_VALUE_POSITION,
  resolveCompletionContext,
};
